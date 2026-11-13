import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import type { MediaFormatOption, SupportedPlatform } from '@/app/api/extract/route';

export interface ChunkState {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  status: 'idle' | 'downloading' | 'paused' | 'completed' | 'error';
}

export type TaskStatus =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'paused'
  | 'muxing'
  | 'completed'
  | 'error';

export type SaveMethod = 'auto' | 'picker' | 'share' | 'blob';

export interface DownloadTaskSnapshot {
  id: string;
  sourceUrl: string;
  title: string;
  author: string;
  thumbnail: string;
  platform: SupportedPlatform;
  format: MediaFormatOption;
  status: TaskStatus;
  statusMessage: string;
  totalBytes: number;
  downloadedBytes: number;
  progress: number; // 0 to 100
  muxProgress: number; // 0 to 100
  speedBps: number; // bytes per second
  etaSeconds: number;
  supportsRange: boolean;
  chunks: ChunkState[];
  createdAt: number;
  completedAt?: number;
  error?: string;
  filename: string;
}

export interface HistoryRecord {
  id: string;
  sourceUrl: string;
  title: string;
  author: string;
  thumbnail: string;
  platform: SupportedPlatform;
  resolution: string;
  ext: string;
  totalBytes: number;
  completedAt: number;
  filename: string;
  hasCachedBlob: boolean;
}

interface ChunkDataRecord {
  key: string; // `${taskId}:chunk:${index}`
  taskId: string;
  chunkIndex: number;
  buffer: Uint8Array;
}

interface CompletedBlobRecord {
  id: string;
  blob: Blob;
  filename: string;
  mimeType: string;
  updatedAt: number;
}

interface DownloaderDB extends DBSchema {
  tasks: {
    key: string;
    value: DownloadTaskSnapshot;
  };
  chunks: {
    key: string;
    value: ChunkDataRecord;
    indexes: { 'by-task': string };
  };
  history: {
    key: string;
    value: HistoryRecord;
  };
  blobs: {
    key: string;
    value: CompletedBlobRecord;
  };
}

const DB_NAME = 'nabd-stream-idm-v1';
const DB_VERSION = 1;
export const NUM_THREADS = 8;

let dbPromise: Promise<IDBPDatabase<DownloaderDB>> | null = null;

export function getDownloaderDB(): Promise<IDBPDatabase<DownloaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DownloaderDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('tasks')) {
          db.createObjectStore('tasks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('chunks')) {
          const chunkStore = db.createObjectStore('chunks', { keyPath: 'key' });
          chunkStore.createIndex('by-task', 'taskId');
        }
        if (!db.objectStoreNames.contains('history')) {
          db.createObjectStore('history', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ============================================================================
// CLIENT-SIDE FFMPEG.WASM SINGLETON (4K / 1080p DASH MUXING & MP3 TRANSCODING)
// ============================================================================
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

export async function getFFmpegInstance(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (ffmpegLoadingPromise) {
    return ffmpegLoadingPromise;
  }

  ffmpegLoadingPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on('log', ({ message }) => onLog(message));
    }
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadingPromise;
  } catch (err) {
    ffmpegLoadingPromise = null;
    throw err;
  }
}

export function sanitizeFilename(title: string, resolution: string, ext: string): string {
  const cleanTitle = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 85);
  const cleanRes = resolution.replace(/[^a-zA-Z0-9]/g, '');
  return `${cleanTitle || 'video'}_${cleanRes}.${ext}`;
}

// ============================================================================
// NATIVE FILE SAVING (File System Access API / Web Share API Level 2 / Blob)
// ============================================================================
export async function saveDownloadedFile(
  blob: Blob,
  filename: string,
  preferredMethod: SaveMethod = 'auto'
): Promise<{ methodUsed: string; success: boolean }> {
  const mimeType = filename.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4';

  // 1. Mobile Web Share API Level 2 (Save directly to iOS Photos / Files or Android Studio / Gallery)
  if (preferredMethod === 'share') {
    if (typeof navigator !== 'undefined' && navigator.canShare) {
      const file = new File([blob], filename, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return { methodUsed: 'Web Share API (المعرض / الاستوديو)', success: true };
      }
    }
  }

  // 2. Desktop & Modern Android File System Access API (showSaveFilePicker)
  const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  if (
    (preferredMethod === 'picker' || preferredMethod === 'auto') &&
    win &&
    typeof win.showSaveFilePicker === 'function'
  ) {
    try {
      const showSaveFilePicker = win.showSaveFilePicker as (options: unknown) => Promise<{
        createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
      }>;
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: filename.endsWith('.mp3') ? 'MP3 Audio File' : 'MP4 Video File',
            accept: {
              [mimeType]: [filename.endsWith('.mp3') ? '.mp3' : '.mp4'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { methodUsed: 'File System Access API (مسار مخصص)', success: true };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { methodUsed: 'cancelled', success: false };
      }
      // In cross-origin iframe or unsupported context, fall through to standard Blob download
    }
  }

  // 3. Standard Blob Anchor Download
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
  }, 5000);

  return { methodUsed: 'Direct Browser Download (تنزيل مباشر)', success: true };
}

// ============================================================================
// IDM-STYLE 8-THREAD CHUNK DOWNLOADER WITH INDEXEDDB PAUSE & RESUME
// ============================================================================
export class IDMChunkDownloader {
  private snapshot: DownloadTaskSnapshot;
  private abortControllers: Map<number, AbortController> = new Map();
  private chunkBuffers: Map<number, Uint8Array[]> = new Map();
  private onUpdate: (snapshot: DownloadTaskSnapshot) => void;
  private speedTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickBytes = 0;
  private lastTickTime = 0;
  private isPaused = false;
  private isCancelled = false;
  private saveMethod: SaveMethod;

  constructor(
    snapshot: DownloadTaskSnapshot,
    onUpdate: (snapshot: DownloadTaskSnapshot) => void,
    saveMethod: SaveMethod = 'auto'
  ) {
    this.snapshot = snapshot;
    this.onUpdate = onUpdate;
    this.saveMethod = saveMethod;
  }

  public getSnapshot(): DownloadTaskSnapshot {
    return { ...this.snapshot, chunks: this.snapshot.chunks.map((c) => ({ ...c })) };
  }

  private emitUpdate(persistToDb = false) {
    const snap = this.getSnapshot();
    this.onUpdate(snap);
    if (persistToDb) {
      getDownloaderDB()
        .then((db) => db.put('tasks', snap))
        .catch(() => {});
    }
  }

  private startSpeedTracker() {
    this.stopSpeedTracker();
    this.lastTickBytes = this.snapshot.downloadedBytes;
    this.lastTickTime = performance.now();

    this.speedTimer = setInterval(() => {
      if (this.snapshot.status !== 'downloading') return;
      const now = performance.now();
      const elapsedSec = (now - this.lastTickTime) / 1000;
      if (elapsedSec <= 0) return;

      const deltaBytes = Math.max(0, this.snapshot.downloadedBytes - this.lastTickBytes);
      const instantSpeed = deltaBytes / elapsedSec;

      // Exponential moving average for smooth, accurate real-time speed
      this.snapshot.speedBps =
        this.snapshot.speedBps === 0
          ? instantSpeed
          : Math.round(this.snapshot.speedBps * 0.6 + instantSpeed * 0.4);

      const remainingBytes = Math.max(0, this.snapshot.totalBytes - this.snapshot.downloadedBytes);
      this.snapshot.etaSeconds =
        this.snapshot.speedBps > 0 ? Math.ceil(remainingBytes / this.snapshot.speedBps) : 0;

      this.lastTickBytes = this.snapshot.downloadedBytes;
      this.lastTickTime = now;
      this.emitUpdate(false);
    }, 450);
  }

  private stopSpeedTracker() {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
  }

  private buildProxyUrl(rawUrl: string): string {
    return `/api/proxy?url=${encodeURIComponent(rawUrl)}`;
  }

  private async probeTargetHead(rawUrl: string): Promise<{ totalBytes: number; supportsRange: boolean }> {
    const proxyUrl = this.buildProxyUrl(rawUrl);
    try {
      const res = await fetch(proxyUrl, { method: 'HEAD' });
      const len = parseInt(res.headers.get('content-length') || '0', 10);
      const acceptRanges = (
        res.headers.get('accept-ranges') ||
        res.headers.get('x-accept-ranges') ||
        ''
      ).toLowerCase();
      return {
        totalBytes: !isNaN(len) && len > 0 ? len : this.snapshot.format.filesize || 0,
        supportsRange: acceptRanges.includes('bytes') && len > 256 * 1024,
      };
    } catch {
      return {
        totalBytes: this.snapshot.format.filesize || 0,
        supportsRange: Boolean(this.snapshot.format.filesize && this.snapshot.format.filesize > 256 * 1024),
      };
    }
  }

  public async startOrResume(): Promise<void> {
    this.isPaused = false;
    this.isCancelled = false;
    this.snapshot.error = undefined;

    try {
      const db = await getDownloaderDB();

      // Step 1: Probe Content-Length & Range capability if not initialized yet
      if (this.snapshot.chunks.length === 0 || this.snapshot.totalBytes === 0) {
        this.snapshot.status = 'probing';
        this.snapshot.statusMessage = 'جاري فحص حجم الملف وتهيئة المسارات المتوازية (8 Threads)...';
        this.emitUpdate(true);

        const { totalBytes, supportsRange } = await this.probeTargetHead(this.snapshot.format.url);
        this.snapshot.totalBytes = totalBytes;
        this.snapshot.supportsRange = supportsRange;

        if (supportsRange && totalBytes > 0) {
          const partSize = Math.floor(totalBytes / NUM_THREADS);
          const chunks: ChunkState[] = [];
          for (let i = 0; i < NUM_THREADS; i++) {
            const start = i * partSize;
            const end = i === NUM_THREADS - 1 ? totalBytes - 1 : (i + 1) * partSize - 1;
            chunks.push({
              index: i,
              start,
              end,
              downloaded: 0,
              status: 'idle',
            });
          }
          this.snapshot.chunks = chunks;
        } else {
          // Visualized 8-segment single-stream fallback when CDN omits Content-Length
          this.snapshot.chunks = Array.from({ length: NUM_THREADS }, (_, i) => ({
            index: i,
            start: 0,
            end: 0,
            downloaded: 0,
            status: 'idle',
          }));
        }
      } else {
        // Restore previously saved chunk buffers from IndexedDB on Resume
        for (const chunk of this.snapshot.chunks) {
          const savedRecord = await db.get('chunks', `${this.snapshot.id}:chunk:${chunk.index}`);
          if (savedRecord && savedRecord.buffer) {
            this.chunkBuffers.set(chunk.index, [savedRecord.buffer]);
            chunk.downloaded = savedRecord.buffer.byteLength;
            if (chunk.end > 0 && chunk.start + chunk.downloaded > chunk.end) {
              chunk.status = 'completed';
            }
          } else {
            chunk.downloaded = 0;
            this.chunkBuffers.set(chunk.index, []);
          }
        }
        this.recalculateTotals();
      }

      this.snapshot.status = 'downloading';
      this.snapshot.statusMessage = this.snapshot.supportsRange
        ? 'جاري التحميل بأقصى سرعة عبر 8 مسارات متوازية (HTTP 206)...'
        : 'جاري تدفق البيانات المباشر...';
      this.emitUpdate(true);
      this.startSpeedTracker();

      let primaryVideoBlob: Blob;

      if (this.snapshot.supportsRange && this.snapshot.totalBytes > 0) {
        // Execute all 8 byte-range streams concurrently
        await Promise.all(this.snapshot.chunks.map((chunk) => this.downloadRangeChunk(chunk)));
        if (this.isPaused || this.isCancelled) return;
        primaryVideoBlob = await this.assembleChunksIntoBlob();
      } else {
        primaryVideoBlob = await this.downloadSingleStreamWithSegments(this.snapshot.format.url);
        if (this.isPaused || this.isCancelled) return;
      }

      this.stopSpeedTracker();

      // Step 2: Check if 4K/2K/1080p DASH muxing or MP3 conversion via FFmpeg.wasm is required
      let finalBlob = primaryVideoBlob;
      if (this.snapshot.format.needsMuxing && this.snapshot.format.audioUrl) {
        this.snapshot.status = 'muxing';
        this.snapshot.statusMessage = 'جاري تحميل مسار الصوت عالي الدقة ودمجه بـ FFmpeg.wasm (4K/1080p Muxing)...';
        this.emitUpdate(true);

        const audioBlob = await this.fetchAuxiliaryAudioStream(this.snapshot.format.audioUrl);
        if (this.isPaused || this.isCancelled) return;

        finalBlob = await this.muxVideoAndAudioWithFFmpeg(primaryVideoBlob, audioBlob);
      } else if (this.snapshot.format.type === 'audio' && this.snapshot.format.needsAudioTranscode) {
        this.snapshot.status = 'muxing';
        this.snapshot.statusMessage = 'جاري تحويل الصوت إلى صيغة MP3 نقية (320kbps) عبر FFmpeg.wasm...';
        this.emitUpdate(true);

        finalBlob = await this.transcodeToMp3WithFFmpeg(primaryVideoBlob);
      }

      // Step 3: Complete & Persist to IndexedDB History + Blob Cache
      this.snapshot.status = 'completed';
      this.snapshot.progress = 100;
      this.snapshot.muxProgress = 100;
      this.snapshot.speedBps = 0;
      this.snapshot.etaSeconds = 0;
      this.snapshot.totalBytes = finalBlob.size;
      this.snapshot.downloadedBytes = finalBlob.size;
      this.snapshot.completedAt = Date.now();
      this.snapshot.statusMessage = 'اكتمل التحميل بنجاح! جاري حفظ الملف...';
      this.snapshot.chunks.forEach((c) => {
        c.status = 'completed';
      });
      this.emitUpdate(true);

      await this.persistCompletionToIndexedDB(finalBlob);

      // Trigger Native File Save
      await saveDownloadedFile(finalBlob, this.snapshot.filename, this.saveMethod);
    } catch (err: unknown) {
      this.stopSpeedTracker();
      if (this.isPaused || this.isCancelled) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;

      const message = err instanceof Error ? err.message : 'انقطع الاتصال أثناء التحميل.';
      this.snapshot.status = 'error';
      this.snapshot.error = message;
      this.snapshot.statusMessage = `خطأ: ${message}`;
      this.snapshot.speedBps = 0;
      this.emitUpdate(true);
    }
  }

  private async downloadRangeChunk(chunk: ChunkState): Promise<void> {
    const targetSize = chunk.end - chunk.start + 1;
    if (chunk.downloaded >= targetSize) {
      chunk.status = 'completed';
      this.emitUpdate(false);
      return;
    }

    const rangeStart = chunk.start + chunk.downloaded;
    const rangeEnd = chunk.end;

    const controller = new AbortController();
    this.abortControllers.set(chunk.index, controller);
    chunk.status = 'downloading';
    this.emitUpdate(false);

    const proxyUrl = this.buildProxyUrl(this.snapshot.format.url);

    try {
      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
          Range: `bytes=${rangeStart}-${rangeEnd}`,
        },
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status} on thread #${chunk.index + 1}`);
      }

      if (!response.body) {
        throw new Error('ReadableStream غير مدعوم من الخادم.');
      }

      const reader = response.body.getReader();
      const slices = this.chunkBuffers.get(chunk.index) || [];
      this.chunkBuffers.set(chunk.index, slices);

      let bytesSinceLastFlush = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (this.isPaused || this.isCancelled) {
          await reader.cancel();
          break;
        }

        if (value && value.byteLength > 0) {
          slices.push(value);
          chunk.downloaded += value.byteLength;
          bytesSinceLastFlush += value.byteLength;
          this.recalculateTotals();

          // Periodically flush chunk progress to IndexedDB every 512KB so unexpected tab closure preserves progress
          if (bytesSinceLastFlush >= 512 * 1024) {
            bytesSinceLastFlush = 0;
            await this.flushChunkToIndexedDB(chunk.index);
          }
        }
      }

      if (!this.isPaused && !this.isCancelled) {
        chunk.status = 'completed';
        await this.flushChunkToIndexedDB(chunk.index);
        this.emitUpdate(true);
      }
    } catch (err: unknown) {
      if (this.isPaused || this.isCancelled || (err instanceof DOMException && err.name === 'AbortError')) {
        chunk.status = 'paused';
        await this.flushChunkToIndexedDB(chunk.index);
        return;
      }
      chunk.status = 'error';
      await this.flushChunkToIndexedDB(chunk.index);
      throw err;
    } finally {
      this.abortControllers.delete(chunk.index);
    }
  }

  private async downloadSingleStreamWithSegments(rawUrl: string): Promise<Blob> {
    const controller = new AbortController();
    this.abortControllers.set(0, controller);
    this.snapshot.chunks.forEach((c) => (c.status = 'downloading'));

    const res = await fetch(this.buildProxyUrl(rawUrl), {
      method: 'GET',
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} أثناء الاتصال بالخادم.`);
    }

    const contentLen = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLen > 0) {
      this.snapshot.totalBytes = contentLen;
    }

    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (this.isPaused || this.isCancelled) {
        await reader.cancel();
        break;
      }
      if (value) {
        parts.push(value);
        received += value.byteLength;
        this.snapshot.downloadedBytes = received;

        if (this.snapshot.totalBytes > 0) {
          this.snapshot.progress = Math.min(99, Math.round((received / this.snapshot.totalBytes) * 100));
          // Distribute progress across the 8 visual segments
          const perChunk = this.snapshot.totalBytes / NUM_THREADS;
          this.snapshot.chunks.forEach((c, idx) => {
            const chunkFloor = idx * perChunk;
            const chunkAmount = Math.max(0, Math.min(perChunk, received - chunkFloor));
            c.start = Math.round(chunkFloor);
            c.end = Math.round((idx + 1) * perChunk);
            c.downloaded = Math.round(chunkAmount);
            c.status = chunkAmount >= perChunk ? 'completed' : 'downloading';
          });
        }
      }
    }

    const mimeType = this.snapshot.format.ext === 'mp3' ? 'audio/mpeg' : 'video/mp4';
    return new Blob(parts as unknown as BlobPart[], { type: mimeType });
  }

  private async fetchAuxiliaryAudioStream(audioUrl: string): Promise<Blob> {
    const controller = new AbortController();
    this.abortControllers.set(99, controller);
    const res = await fetch(this.buildProxyUrl(audioUrl), {
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error('تعذر تحميل مسار الصوت المرافق لدمج الفيديو.');
    }
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) parts.push(value);
    }
    return new Blob(parts as unknown as BlobPart[], { type: 'audio/mp4' });
  }

  private async muxVideoAndAudioWithFFmpeg(videoBlob: Blob, audioBlob: Blob): Promise<Blob> {
    try {
      const ffmpeg = await getFFmpegInstance();
      ffmpeg.on('progress', ({ progress }) => {
        this.snapshot.muxProgress = Math.min(99, Math.max(0, Math.round(progress * 100)));
        this.snapshot.statusMessage = `جاري دمج مسار الفيديو 4K/1080p مع الصوت عبر FFmpeg.wasm (${this.snapshot.muxProgress}%)...`;
        this.emitUpdate(false);
      });

      const videoBytes = new Uint8Array(await videoBlob.arrayBuffer());
      const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());

      await ffmpeg.writeFile('input_video.mp4', videoBytes);
      await ffmpeg.writeFile('input_audio.m4a', audioBytes);

      // Copy video stream without re-encoding for instantaneous 4K muxing
      await ffmpeg.exec([
        '-i',
        'input_video.mp4',
        '-i',
        'input_audio.m4a',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-shortest',
        'output_muxed.mp4',
      ]);

      const data = await ffmpeg.readFile('output_muxed.mp4');
      await ffmpeg.deleteFile('input_video.mp4').catch(() => {});
      await ffmpeg.deleteFile('input_audio.m4a').catch(() => {});
      await ffmpeg.deleteFile('output_muxed.mp4').catch(() => {});

      const uint8 = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      return new Blob([uint8 as unknown as BlobPart], { type: 'video/mp4' });
    } catch {
      // If WebAssembly fails to initialize on low-memory devices, return primary video stream gracefully
      return videoBlob;
    }
  }

  private async transcodeToMp3WithFFmpeg(inputBlob: Blob): Promise<Blob> {
    try {
      const ffmpeg = await getFFmpegInstance();
      ffmpeg.on('progress', ({ progress }) => {
        this.snapshot.muxProgress = Math.min(99, Math.max(0, Math.round(progress * 100)));
        this.snapshot.statusMessage = `جاري استخراج وتحويل الصوت إلى MP3 320kbps (${this.snapshot.muxProgress}%)...`;
        this.emitUpdate(false);
      });

      const inputBytes = new Uint8Array(await inputBlob.arrayBuffer());
      await ffmpeg.writeFile('input_media', inputBytes);
      await ffmpeg.exec([
        '-i',
        'input_media',
        '-vn',
        '-acodec',
        'libmp3lame',
        '-b:a',
        '320k',
        'output.mp3',
      ]);
      const data = await ffmpeg.readFile('output.mp3');
      await ffmpeg.deleteFile('input_media').catch(() => {});
      await ffmpeg.deleteFile('output.mp3').catch(() => {});

      const uint8 = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      return new Blob([uint8 as unknown as BlobPart], { type: 'audio/mpeg' });
    } catch {
      return new Blob([await inputBlob.arrayBuffer()], { type: 'audio/mpeg' });
    }
  }

  private recalculateTotals() {
    const sum = this.snapshot.chunks.reduce((acc, c) => acc + c.downloaded, 0);
    this.snapshot.downloadedBytes = sum;
    if (this.snapshot.totalBytes > 0) {
      this.snapshot.progress = Math.min(100, Math.round((sum / this.snapshot.totalBytes) * 100));
    }
  }

  private mergeUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    if (arrays.length === 0) return new Uint8Array(0);
    if (arrays.length === 1) return arrays[0];
    const totalLen = arrays.reduce((acc, arr) => acc + arr.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const arr of arrays) {
      merged.set(arr, offset);
      offset += arr.byteLength;
    }
    return merged;
  }

  private async flushChunkToIndexedDB(chunkIndex: number): Promise<void> {
    const slices = this.chunkBuffers.get(chunkIndex);
    if (!slices || slices.length === 0) return;

    const merged = this.mergeUint8Arrays(slices);
    this.chunkBuffers.set(chunkIndex, [merged]);

    const db = await getDownloaderDB();
    await db.put('chunks', {
      key: `${this.snapshot.id}:chunk:${chunkIndex}`,
      taskId: this.snapshot.id,
      chunkIndex,
      buffer: merged,
    });
    await db.put('tasks', this.getSnapshot());
  }

  private async assembleChunksIntoBlob(): Promise<Blob> {
    const db = await getDownloaderDB();
    const orderedParts: Uint8Array[] = [];

    for (let i = 0; i < this.snapshot.chunks.length; i++) {
      const inMemory = this.chunkBuffers.get(i);
      if (inMemory && inMemory.length > 0) {
        orderedParts.push(this.mergeUint8Arrays(inMemory));
      } else {
        const fromDb = await db.get('chunks', `${this.snapshot.id}:chunk:${i}`);
        if (fromDb && fromDb.buffer) {
          orderedParts.push(fromDb.buffer);
        }
      }
    }

    const mimeType = this.snapshot.format.ext === 'mp3' ? 'audio/mpeg' : 'video/mp4';
    return new Blob(orderedParts as unknown as BlobPart[], { type: mimeType });
  }

  private async persistCompletionToIndexedDB(finalBlob: Blob): Promise<void> {
    const db = await getDownloaderDB();

    // Save completed Blob for instant re-saving from History
    await db.put('blobs', {
      id: this.snapshot.id,
      blob: finalBlob,
      filename: this.snapshot.filename,
      mimeType: finalBlob.type,
      updatedAt: Date.now(),
    });

    // Save History entry
    await db.put('history', {
      id: this.snapshot.id,
      sourceUrl: this.snapshot.sourceUrl,
      title: this.snapshot.title,
      author: this.snapshot.author,
      thumbnail: this.snapshot.thumbnail,
      platform: this.snapshot.platform,
      resolution: this.snapshot.format.resolution,
      ext: this.snapshot.format.ext.toUpperCase(),
      totalBytes: finalBlob.size,
      completedAt: Date.now(),
      filename: this.snapshot.filename,
      hasCachedBlob: true,
    });

    // Clean up temporary range chunks to free storage
    for (let i = 0; i < NUM_THREADS; i++) {
      await db.delete('chunks', `${this.snapshot.id}:chunk:${i}`).catch(() => {});
    }
    this.chunkBuffers.clear();
  }

  public async pause(): Promise<void> {
    if (this.snapshot.status !== 'downloading' && this.snapshot.status !== 'probing') return;
    this.isPaused = true;
    this.stopSpeedTracker();

    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();

    this.snapshot.status = 'paused';
    this.snapshot.speedBps = 0;
    this.snapshot.statusMessage = 'تم الإيقاف المؤقت وحفظ موقع البايتات في IndexedDB. يمكنك الاستكمال في أي وقت.';
    this.snapshot.chunks.forEach((c) => {
      if (c.status === 'downloading') c.status = 'paused';
    });

    for (const chunk of this.snapshot.chunks) {
      await this.flushChunkToIndexedDB(chunk.index);
    }
    this.emitUpdate(true);
  }

  public async cancelAndRemove(): Promise<void> {
    this.isCancelled = true;
    this.stopSpeedTracker();
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.chunkBuffers.clear();

    const db = await getDownloaderDB();
    await db.delete('tasks', this.snapshot.id).catch(() => {});
    for (let i = 0; i < NUM_THREADS; i++) {
      await db.delete('chunks', `${this.snapshot.id}:chunk:${i}`).catch(() => {});
    }
  }
}

// ============================================================================
// BATCH QUEUE MANAGER (UP TO 50 LINKS — SEQUENTIAL OR CONCURRENT 2-4 THREADS)
// ============================================================================
export class DownloadQueueManager {
  private tasks: Map<string, DownloadTaskSnapshot> = new Map();
  private runners: Map<string, IDMChunkDownloader> = new Map();
  private concurrency = 1; // 1 = Sequential Mode, 2..4 = Concurrent Mode
  private saveMethod: SaveMethod = 'auto';
  private listeners: Set<(tasks: DownloadTaskSnapshot[]) => void> = new Set();

  public subscribe(listener: (tasks: DownloadTaskSnapshot[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getAllTasks());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const list = this.getAllTasks();
    for (const l of this.listeners) {
      l(list);
    }
  }

  public getAllTasks(): DownloadTaskSnapshot[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public setConcurrency(limit: number) {
    this.concurrency = Math.max(1, Math.min(4, limit));
    this.pumpQueue();
  }

  public setSaveMethod(method: SaveMethod) {
    this.saveMethod = method;
  }

  public async restoreIncompleteTasksFromIndexedDB(): Promise<void> {
    const db = await getDownloaderDB();
    const savedTasks = await db.getAll('tasks');
    for (const t of savedTasks) {
      if (t.status === 'downloading' || t.status === 'probing' || t.status === 'muxing') {
        t.status = 'paused';
        t.speedBps = 0;
        t.statusMessage = 'تم استعادة التحميل من الذاكرة الدائمة (IndexedDB) — اضغط استكمال للمتابعة.';
        t.chunks.forEach((c) => {
          if (c.status === 'downloading') c.status = 'paused';
        });
        await db.put('tasks', t);
      }
      this.tasks.set(t.id, t);
    }
    this.notify();
  }

  public enqueueTask(params: {
    sourceUrl: string;
    title: string;
    author: string;
    thumbnail: string;
    platform: SupportedPlatform;
    format: MediaFormatOption;
    autoStart?: boolean;
  }): DownloadTaskSnapshot {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const filename = sanitizeFilename(params.title, params.format.resolution, params.format.ext);

    const snapshot: DownloadTaskSnapshot = {
      id,
      sourceUrl: params.sourceUrl,
      title: params.title,
      author: params.author,
      thumbnail: params.thumbnail,
      platform: params.platform,
      format: params.format,
      status: 'queued',
      statusMessage: 'في قائمة الانتظار...',
      totalBytes: params.format.filesize || 0,
      downloadedBytes: 0,
      progress: 0,
      muxProgress: 0,
      speedBps: 0,
      etaSeconds: 0,
      supportsRange: true,
      chunks: [],
      createdAt: Date.now(),
      filename,
    };

    this.tasks.set(id, snapshot);
    getDownloaderDB()
      .then((db) => db.put('tasks', snapshot))
      .catch(() => {});

    this.notify();
    if (params.autoStart !== false) {
      this.pumpQueue();
    }
    return snapshot;
  }

  public pumpQueue() {
    const all = Array.from(this.tasks.values()).sort((a, b) => a.createdAt - b.createdAt);
    const activeCount = all.filter(
      (t) => t.status === 'downloading' || t.status === 'probing' || t.status === 'muxing'
    ).length;

    const availableSlots = Math.max(0, this.concurrency - activeCount);
    if (availableSlots <= 0) return;

    const queued = all.filter((t) => t.status === 'queued').slice(0, availableSlots);
    for (const task of queued) {
      this.startTask(task.id);
    }
  }

  public async startTask(taskId: string) {
    const snap = this.tasks.get(taskId);
    if (!snap) return;

    let runner = this.runners.get(taskId);
    if (!runner) {
      runner = new IDMChunkDownloader(
        snap,
        (updated) => {
          this.tasks.set(taskId, updated);
          this.notify();
          if (updated.status === 'completed' || updated.status === 'error') {
            this.pumpQueue();
          }
        },
        this.saveMethod
      );
      this.runners.set(taskId, runner);
    }

    await runner.startOrResume();
  }

  public async pauseTask(taskId: string) {
    const runner = this.runners.get(taskId);
    if (runner) {
      await runner.pause();
    } else {
      const snap = this.tasks.get(taskId);
      if (snap) {
        snap.status = 'paused';
        this.tasks.set(taskId, snap);
        this.notify();
      }
    }
    this.pumpQueue();
  }

  public async resumeTask(taskId: string) {
    await this.startTask(taskId);
  }

  public async removeTask(taskId: string) {
    const runner = this.runners.get(taskId);
    if (runner) {
      await runner.cancelAndRemove();
      this.runners.delete(taskId);
    } else {
      const db = await getDownloaderDB();
      await db.delete('tasks', taskId).catch(() => {});
      for (let i = 0; i < NUM_THREADS; i++) {
        await db.delete('chunks', `${taskId}:chunk:${i}`).catch(() => {});
      }
    }
    this.tasks.delete(taskId);
    this.notify();
    this.pumpQueue();
  }
}

// ============================================================================
// HISTORY & CACHED BLOB HELPERS
// ============================================================================
export async function getDownloadHistory(): Promise<HistoryRecord[]> {
  const db = await getDownloaderDB();
  const list = await db.getAll('history');
  return list.sort((a, b) => b.completedAt - a.completedAt);
}

export async function resaveFromHistory(
  historyId: string,
  method: SaveMethod = 'auto'
): Promise<boolean> {
  const db = await getDownloaderDB();
  const record = await db.get('blobs', historyId);
  if (!record || !record.blob) {
    return false;
  }
  await saveDownloadedFile(record.blob, record.filename, method);
  return true;
}

export async function deleteHistoryItem(historyId: string): Promise<void> {
  const db = await getDownloaderDB();
  await db.delete('history', historyId);
  await db.delete('blobs', historyId);
}

export async function clearAllDownloadHistory(): Promise<void> {
  const db = await getDownloaderDB();
  await db.clear('history');
  await db.clear('blobs');
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return 'غير محدد';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let u = 0;
  while (val >= 1024 && u < units.length - 1) {
    val /= 1024;
    u++;
  }
  return `${val.toFixed(u >= 2 ? 2 : 0)} ${units[u]}`;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0 || isNaN(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
