import { NextRequest, NextResponse } from 'next/server';
import { Ytdl } from '@distube/ytdl-core';
import ytpl from '@distube/ytpl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ytdlClient = new Ytdl();

export type SupportedPlatform =
  | 'youtube'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'twitter'
  | 'direct';

export interface MediaFormatOption {
  id: string;
  label: string;
  resolution: string; // '144p' | '240p' | '360p' | '480p' | '720p' | '1080p' | '1440p (2K)' | '2160p (4K)' | 'MP3'
  height?: number;
  ext: 'mp4' | 'mp3' | 'webm' | 'm4a';
  type: 'video' | 'audio';
  url: string;
  audioUrl?: string; // Populated when high-res DASH stream (1080p/2K/4K) requires FFmpeg.wasm muxing
  needsMuxing: boolean;
  needsAudioTranscode?: boolean;
  filesize?: number;
  fps?: number;
  codec?: string;
  badge?: string;
}

export interface ExtractedMediaResult {
  isPlaylist?: false;
  id: string;
  url: string;
  platform: SupportedPlatform;
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  formats: MediaFormatOption[];
  resolverEngine: string;
}

export interface PlaylistVideoItem {
  id: string;
  url: string;
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
}

export interface ExtractedPlaylistResult {
  isPlaylist: true;
  id: string;
  url: string;
  platform: 'youtube';
  title: string;
  author: string;
  thumbnail: string;
  itemCount: number;
  items: PlaylistVideoItem[];
  resolverEngine: string;
}

interface CobaltEndpoint {
  url: string;
  version: 10 | 7;
  apiKey?: string;
}

const ALLOWED_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160];

const RESOLUTION_LABELS: Record<number, { resolution: string; badge: string }> = {
  2160: { resolution: '2160p (4K)', badge: '4K Ultra HD' },
  1440: { resolution: '1440p (2K)', badge: '2K QHD' },
  1080: { resolution: '1080p', badge: 'Full HD' },
  720: { resolution: '720p', badge: 'HD' },
  480: { resolution: '480p', badge: 'SD' },
  360: { resolution: '360p', badge: 'Low' },
  240: { resolution: '240p', badge: 'Eco' },
  144: { resolution: '144p', badge: 'Data Saver' },
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Multi-instance Cobalt API v10+ & v7 cluster (plus optional custom env instance)
function getCobaltCluster(): CobaltEndpoint[] {
  const cluster: CobaltEndpoint[] = [];
  const customUrl = process.env.COBALT_API_URL?.trim();
  const customKey = process.env.COBALT_API_KEY?.trim();

  if (customUrl) {
    cluster.push({
      url: customUrl.replace(/\/+$/, ''),
      version: 10,
      apiKey: customKey || undefined,
    });
  }

  cluster.push(
    { url: 'https://cobalt-api.kwiatekmiki.com', version: 10 },
    { url: 'https://cobalt-backend.canine.tools', version: 10 },
    { url: 'https://api.cobalt.best', version: 10 },
    { url: 'https://co.eepy.today', version: 10 },
    { url: 'https://cobalt.api.timelessnesses.me', version: 10 },
    { url: 'https://api.cobalt.tools', version: 10 }
  );

  return cluster;
}

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
  'https://api.piped.private.coffee',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.tux.pizza',
  'https://invidious.nerdvpn.de',
  'https://invidious.jing.rocks',
  'https://iv.ggtyler.dev',
];

function detectPlatform(rawUrl: string): SupportedPlatform {
  const lower = rawUrl.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.gg')) return 'facebook';
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'instagram';
  if (lower.includes('tiktok.com') || lower.includes('vm.tiktok.com') || lower.includes('vt.tiktok.com')) return 'tiktok';
  if (lower.includes('twitter.com') || lower.includes('x.com') || lower.includes('t.co')) return 'twitter';
  return 'direct';
}

function snapToStandardHeight(rawHeight: number): number | null {
  if (!rawHeight || rawHeight <= 0) return null;
  for (const std of ALLOWED_HEIGHTS) {
    if (Math.abs(rawHeight - std) <= 36) {
      return std;
    }
  }
  if (rawHeight === 1920) return 1080;
  if (rawHeight === 1280) return 720;
  if (rawHeight === 854) return 480;
  if (rawHeight === 640) return 360;
  if (rawHeight === 2560) return 1440;
  if (rawHeight === 3840) return 2160;
  return null;
}

function parseDurationString(raw?: string | null): number {
  if (!raw) return 0;
  const parts = raw
    .trim()
    .split(':')
    .map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

async function probeStreamSize(url: string, referer?: string): Promise<number | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Range: 'bytes=0-0',
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    const contentRange = res.headers.get('content-range');
    try {
      await res.body?.cancel();
    } catch {
      // ignore stream cancel error
    }

    if (contentRange && contentRange.includes('/')) {
      const total = parseInt(contentRange.split('/')[1], 10);
      if (!isNaN(total) && total > 0) return total;
    }
    const contentLen = parseInt(res.headers.get('content-length') || '', 10);
    if (!isNaN(contentLen) && contentLen > 1) return contentLen;
  } catch {
    // Ignore probe timeout
  }
  return undefined;
}

async function fetchOembedMetadata(
  url: string,
  platform: SupportedPlatform,
  fallbackId?: string
): Promise<{ title: string; author: string; thumbnail: string }> {
  let title = `${platform.toUpperCase()} Video`;
  let author = `${platform.toUpperCase()} Creator`;
  let thumbnail =
    platform === 'youtube' && fallbackId
      ? `https://i.ytimg.com/vi/${fallbackId}/hqdefault.jpg`
      : '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data.title) title = String(data.title);
      if (data.author_name) author = String(data.author_name);
      if (data.thumbnail_url) thumbnail = String(data.thumbnail_url);
    }
  } catch {
    // Ignore oembed error
  }

  return { title, author, thumbnail };
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
    const shortsMatch = parsed.pathname.match(/\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
  } catch {
    // fallback regex
  }
  const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
  return match ? match[1] : null;
}

function extractYouTubePlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const listParam = parsed.searchParams.get('list');
    if (listParam && listParam.trim().length > 0) {
      return listParam.trim();
    }
  } catch {
    // fallback regex
  }
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ============================================================================
// YOUTUBE PLAYLIST EXTRACTOR (ytpl + InnerTube Browse + HTML Parser + Piped)
// ============================================================================
async function extractYouTubePlaylist(
  url: string,
  maxItems = 50
): Promise<ExtractedPlaylistResult> {
  const playlistId = extractYouTubePlaylistId(url);
  if (!playlistId) {
    throw new Error('لم يتم العثور على معرف قائمة التشغيل (list=) في الرابط.');
  }

  const canonicalPlaylistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;

  // Strategy P1: @distube/ytpl library
  try {
    const plResult = await ytpl(playlistId, { limit: maxItems, hl: 'ar', gl: 'US' });
    if (plResult && Array.isArray(plResult.items) && plResult.items.length > 0) {
      const items: PlaylistVideoItem[] = plResult.items.slice(0, maxItems).map((item) => ({
        id: item.id,
        url: item.url_simple || `https://www.youtube.com/watch?v=${item.id}`,
        title: item.title || `YouTube Video (${item.id})`,
        author: item.author?.name || plResult.author?.name || 'YouTube Creator',
        duration: parseDurationString(item.duration),
        thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      }));

      return {
        isPlaylist: true,
        id: plResult.id || playlistId,
        url: canonicalPlaylistUrl,
        platform: 'youtube',
        title: plResult.title || 'YouTube Playlist',
        author: plResult.author?.name || 'YouTube Creator',
        thumbnail: items[0]?.thumbnail || '',
        itemCount: items.length,
        items,
        resolverEngine: 'YouTube Playlist Resolver (ytpl)',
      };
    }
  } catch {
    // Proceed to Strategy P2 (InnerTube Browse API)
  }

  // Strategy P2: Direct YouTube InnerTube Browse API (VL + playlistId)
  try {
    const browseRes = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        browseId: playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20241111.01.00',
            hl: 'ar',
            gl: 'US',
          },
        },
      }),
    });

    if (browseRes.ok) {
      const browseData = await browseRes.json();
      const rawJson = JSON.stringify(browseData);
      const playlistTitle =
        browseData?.metadata?.playlistMetadataRenderer?.title ||
        browseData?.header?.playlistHeaderRenderer?.title?.simpleText ||
        'YouTube Playlist';

      // Extract all playlistVideoRenderer objects recursively
      const items: PlaylistVideoItem[] = [];
      const seenIds = new Set<string>();

      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object' || items.length >= maxItems) return;
        const obj = node as Record<string, unknown>;

        if (obj.playlistVideoRenderer && typeof obj.playlistVideoRenderer === 'object') {
          const pvr = obj.playlistVideoRenderer as Record<string, unknown>;
          const videoId = typeof pvr.videoId === 'string' ? pvr.videoId : '';
          if (videoId && !seenIds.has(videoId)) {
            seenIds.add(videoId);
            const titleRuns = (pvr.title as { runs?: Array<{ text?: string }> })?.runs;
            const simpleTitle = (pvr.title as { simpleText?: string })?.simpleText;
            const title =
              titleRuns?.[0]?.text || simpleTitle || `YouTube Video (${videoId})`;

            const authorRuns = (pvr.shortBylineText as { runs?: Array<{ text?: string }> })?.runs;
            const author = authorRuns?.[0]?.text || 'YouTube Creator';

            const lengthSeconds = parseInt(String(pvr.lengthSeconds || '0'), 10) || 0;

            items.push({
              id: videoId,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              title,
              author,
              duration: lengthSeconds,
              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            });
          }
        }

        for (const val of Object.values(obj)) {
          if (Array.isArray(val)) {
            for (const child of val) walk(child);
          } else if (val && typeof val === 'object') {
            walk(val);
          }
        }
      };

      walk(browseData);

      // Fallback regex scan if nested structure varied
      if (items.length === 0 && rawJson.includes('"videoId"')) {
        const regex = /"playlistVideoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(rawJson)) !== null && items.length < maxItems) {
          const vid = match[1];
          if (!seenIds.has(vid)) {
            seenIds.add(vid);
            items.push({
              id: vid,
              url: `https://www.youtube.com/watch?v=${vid}`,
              title: `YouTube Video (${vid})`,
              author: 'YouTube Creator',
              duration: 0,
              thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            });
          }
        }
      }

      if (items.length > 0) {
        return {
          isPlaylist: true,
          id: playlistId,
          url: canonicalPlaylistUrl,
          platform: 'youtube',
          title: String(playlistTitle),
          author: items[0]?.author || 'YouTube Creator',
          thumbnail: items[0]?.thumbnail || '',
          itemCount: items.length,
          items,
          resolverEngine: 'YouTube InnerTube Playlist Engine',
        };
      }
    }
  } catch {
    // Proceed to Strategy P3 (Piped & Invidious Playlist APIs)
  }

  // Strategy P3: Piped Playlist API Instances
  for (const instance of PIPED_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${instance}/playlists/${playlistId}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;

      const data = await res.json();
      const relatedStreams = Array.isArray(data.relatedStreams) ? data.relatedStreams : [];
      if (relatedStreams.length > 0) {
        const items: PlaylistVideoItem[] = [];
        for (const stream of relatedStreams.slice(0, maxItems)) {
          const streamUrl = String(stream.url || '');
          const vid =
            extractYouTubeVideoId(`https://www.youtube.com${streamUrl}`) ||
            streamUrl.replace('/watch?v=', '');
          if (!vid) continue;
          items.push({
            id: vid,
            url: `https://www.youtube.com/watch?v=${vid}`,
            title: String(stream.title || `YouTube Video (${vid})`),
            author: String(stream.uploaderName || data.uploader || 'YouTube Creator'),
            duration: Number(stream.duration) || 0,
            thumbnail: String(stream.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`),
          });
        }

        if (items.length > 0) {
          return {
            isPlaylist: true,
            id: playlistId,
            url: canonicalPlaylistUrl,
            platform: 'youtube',
            title: String(data.name || 'YouTube Playlist'),
            author: String(data.uploader || items[0].author || 'YouTube Creator'),
            thumbnail: String(data.thumbnailUrl || items[0].thumbnail),
            itemCount: items.length,
            items,
            resolverEngine: `Piped Playlist Node (${new URL(instance).hostname})`,
          };
        }
      }
    } catch {
      continue;
    }
  }

  // Strategy P4: Invidious Playlist API Instances
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${instance}/api/v1/playlists/${playlistId}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;

      const data = await res.json();
      const videos = Array.isArray(data.videos) ? data.videos : [];
      if (videos.length > 0) {
        const items: PlaylistVideoItem[] = videos.slice(0, maxItems).map((v: Record<string, unknown>) => {
          const vid = String(v.videoId || '');
          return {
            id: vid,
            url: `https://www.youtube.com/watch?v=${vid}`,
            title: String(v.title || `YouTube Video (${vid})`),
            author: String(v.author || data.author || 'YouTube Creator'),
            duration: Number(v.lengthSeconds) || 0,
            thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
          };
        });

        return {
          isPlaylist: true,
          id: playlistId,
          url: canonicalPlaylistUrl,
          platform: 'youtube',
          title: String(data.title || 'YouTube Playlist'),
          author: String(data.author || items[0]?.author || 'YouTube Creator'),
          thumbnail: items[0]?.thumbnail || '',
          itemCount: items.length,
          items,
          resolverEngine: `Invidious Playlist Node (${new URL(instance).hostname})`,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    'تعذر استخراج قائمة التشغيل هذه. تأكد من أن قائمة التشغيل عامة (Public) أو غير مدرجة (Unlisted) وليست خاصة.'
  );
}

// ============================================================================
// COBALT API v10+ & v7 CLIENT REQUEST HELPER
// ============================================================================
interface CobaltResponse {
  status: 'tunnel' | 'redirect' | 'stream' | 'picker' | 'error';
  url?: string;
  filename?: string;
  picker?: Array<{ type?: string; url: string; thumb?: string }>;
  audio?: string;
  error?: { code?: string };
}

async function callCobaltInstance(
  instance: CobaltEndpoint,
  payload: {
    url: string;
    videoQuality?: string;
    downloadMode?: 'auto' | 'audio' | 'mute';
    audioFormat?: 'mp3' | 'ogg' | 'wav' | 'best';
    audioBitrate?: '320' | '256' | '128' | '96' | '64';
  }
): Promise<CobaltResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    };

    if (instance.apiKey) {
      headers['Authorization'] = `Api-Key ${instance.apiKey}`;
    }

    // Try Cobalt v10+ endpoint (POST /)
    const v10Body = {
      url: payload.url,
      videoQuality: payload.videoQuality || '1080',
      audioFormat: payload.audioFormat || 'mp3',
      audioBitrate: payload.audioBitrate || '320',
      filenameStyle: 'basic',
      downloadMode: payload.downloadMode || 'auto',
    };

    let res = await fetch(`${instance.url}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(v10Body),
      signal: controller.signal,
    });

    // If instance is running Cobalt v7, fallback to POST /api/json
    if (res.status === 404 || res.status === 405) {
      const v7Body = {
        url: payload.url,
        vQuality: payload.videoQuality || '1080',
        aFormat: payload.audioFormat || 'mp3',
        filenamePattern: 'basic',
        isAudioOnly: payload.downloadMode === 'audio',
        isTTFullAudio: true,
      };
      res = await fetch(`${instance.url}/api/json`, {
        method: 'POST',
        headers,
        body: JSON.stringify(v7Body),
        signal: controller.signal,
      });
    }

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = (await res.json()) as CobaltResponse;
    if (
      data &&
      (data.status === 'tunnel' ||
        data.status === 'redirect' ||
        data.status === 'stream' ||
        data.status === 'picker')
    ) {
      return data;
    }
    return null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ============================================================================
// MULTI-INSTANCE COBALT API v10+ / v7 DYNAMIC QUALITY EXTRACTOR
// ============================================================================
async function extractViaCobaltCluster(
  url: string,
  platform: SupportedPlatform,
  fallbackId?: string
): Promise<ExtractedMediaResult> {
  const cluster = getCobaltCluster();
  const qualitiesToProbe =
    platform === 'youtube'
      ? [2160, 1440, 1080, 720, 480, 360, 240, 144]
      : [1080, 720, 480];

  for (const instance of cluster) {
    const initial = await callCobaltInstance(instance, {
      url,
      videoQuality: '1080',
      downloadMode: 'auto',
    });

    if (!initial) continue;

    const oembed = await fetchOembedMetadata(url, platform, fallbackId);
    const formats: MediaFormatOption[] = [];
    const seenUrls = new Set<string>();

    if (initial.status === 'picker' && Array.isArray(initial.picker) && initial.picker.length > 0) {
      for (let i = 0; i < initial.picker.length; i++) {
        const item = initial.picker[i];
        if (!item.url || seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        const size = await probeStreamSize(item.url);
        formats.push({
          id: `cobalt-picker-${i + 1}`,
          label: `1080p MP4 (مقطع #${i + 1})`,
          resolution: '1080p',
          height: 1080,
          ext: 'mp4',
          type: 'video',
          url: item.url,
          needsMuxing: false,
          filesize: size,
          badge: `Stream #${i + 1}`,
        });
      }

      if (initial.audio) {
        const aSize = await probeStreamSize(initial.audio);
        formats.push({
          id: 'cobalt-picker-mp3',
          label: 'MP3 (320kbps Audio)',
          resolution: 'MP3',
          ext: 'mp3',
          type: 'audio',
          url: initial.audio,
          needsMuxing: false,
          filesize: aSize,
          badge: '320kbps MP3',
        });
      }
    } else if (initial.url) {
      const probePromises = qualitiesToProbe.map(async (qHeight) => {
        const qRes = await callCobaltInstance(instance, {
          url,
          videoQuality: String(qHeight),
          downloadMode: 'auto',
        });
        if (!qRes || !qRes.url) return null;
        return {
          height: qHeight,
          url: qRes.url,
          filename: qRes.filename,
        };
      });

      const settled = await Promise.allSettled(probePromises);
      for (const item of settled) {
        if (item.status === 'fulfilled' && item.value) {
          const { height, url: qUrl } = item.value;
          if (seenUrls.has(qUrl)) continue;
          seenUrls.add(qUrl);

          const meta = RESOLUTION_LABELS[height] || { resolution: `${height}p`, badge: 'HD' };
          const size = await probeStreamSize(qUrl);
          formats.push({
            id: `cobalt-${height}p`,
            label: `${meta.resolution} MP4`,
            resolution: meta.resolution,
            height,
            ext: 'mp4',
            type: 'video',
            url: qUrl,
            needsMuxing: false,
            filesize: size,
            badge: meta.badge,
          });
        }
      }

      if (formats.length === 0) {
        const size = await probeStreamSize(initial.url);
        formats.push({
          id: 'cobalt-1080p',
          label: '1080p MP4 (الجودة الأصلية الكاملة)',
          resolution: '1080p',
          height: 1080,
          ext: 'mp4',
          type: 'video',
          url: initial.url,
          needsMuxing: false,
          filesize: size,
          badge: 'Full HD',
        });
      }

      const audioRes = await callCobaltInstance(instance, {
        url,
        downloadMode: 'audio',
        audioFormat: 'mp3',
        audioBitrate: '320',
      });

      if (audioRes && audioRes.url) {
        const aSize = await probeStreamSize(audioRes.url);
        formats.push({
          id: 'cobalt-mp3-320',
          label: 'MP3 (320kbps Audio)',
          resolution: 'MP3',
          ext: 'mp3',
          type: 'audio',
          url: audioRes.url,
          needsMuxing: false,
          needsAudioTranscode: false,
          filesize: aSize,
          badge: '320kbps MP3',
        });
      } else {
        formats.push({
          id: 'cobalt-mp3-ffmpeg',
          label: 'MP3 (320kbps Audio)',
          resolution: 'MP3',
          ext: 'mp3',
          type: 'audio',
          url: initial.url,
          needsMuxing: false,
          needsAudioTranscode: true,
          badge: '320kbps MP3',
        });
      }
    }

    if (formats.length > 0) {
      formats.sort((a, b) => {
        if (a.type === 'audio') return 1;
        if (b.type === 'audio') return -1;
        return (b.height || 0) - (a.height || 0);
      });

      const cleanTitle = initial.filename
        ? String(initial.filename).replace(/\.[^/.]+$/, '').replace(/_/g, ' ')
        : oembed.title;

      return {
        id: fallbackId || `cobalt-${Date.now()}`,
        url,
        platform,
        title: cleanTitle,
        author: oembed.author,
        duration: 0,
        thumbnail: oembed.thumbnail,
        formats,
        resolverEngine: `Cobalt API (${new URL(instance.url).hostname})`,
      };
    }
  }

  throw new Error(
    'تعذر استخراج وسائط هذا الرابط حالياً. تأكد من أن الفيديو عام وليس خاصاً أو محمياً بقيود جغرافية.'
  );
}

// ============================================================================
// 1. YOUTUBE EXTRACTOR (ytdl-core + InnerTube VR + Piped/Invidious + Cobalt API)
// ============================================================================
async function extractYouTube(url: string): Promise<ExtractedMediaResult> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error('رابط يوتيوب غير صالح — تعذر استخراج معرف الفيديو.');
  }
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  if (process.env.COBALT_API_URL?.trim()) {
    try {
      return await extractViaCobaltCluster(canonicalUrl, 'youtube', videoId);
    } catch {
      // Fall through to direct DASH resolvers
    }
  }

  // Strategy 1A: @distube/ytdl-core (Full DASH 144p..2160p 4K + Audio streams)
  try {
    const info = await ytdlClient.getInfo(canonicalUrl);
    const details = info.videoDetails;
    const rawFormats = info.formats || [];

    const audioFormats = [...rawFormats]
      .filter((f) => f.hasAudio && !f.hasVideo && f.url)
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

    const bestAudio = audioFormats[0] || rawFormats.find((f) => f.hasAudio && f.url);
    const bestAudioSize = bestAudio?.contentLength ? Number(bestAudio.contentLength) : undefined;

    const byHeight = new Map<number, MediaFormatOption>();

    for (const f of rawFormats) {
      if (!f.hasVideo || !f.url) continue;
      const rawH = f.height || (f.qualityLabel ? parseInt(f.qualityLabel, 10) : 0);
      const stdH = snapToStandardHeight(rawH);
      if (!stdH || !ALLOWED_HEIGHTS.includes(stdH)) continue;

      const isCombined = Boolean(f.hasVideo && f.hasAudio);
      const container = (f.container || '').toLowerCase();
      const isMp4 = container === 'mp4';
      const streamSize = f.contentLength ? Number(f.contentLength) : undefined;
      const totalEstimatedSize =
        streamSize && !isCombined && bestAudioSize ? streamSize + bestAudioSize : streamSize;

      const meta = RESOLUTION_LABELS[stdH];
      const candidate: MediaFormatOption = {
        id: `yt-${stdH}p-${f.itag}`,
        label: `${meta.resolution} MP4`,
        resolution: meta.resolution,
        height: stdH,
        ext: 'mp4',
        type: 'video',
        url: f.url,
        audioUrl: !isCombined && bestAudio ? bestAudio.url : undefined,
        needsMuxing: !isCombined && Boolean(bestAudio?.url),
        filesize: totalEstimatedSize,
        fps: f.fps,
        codec: f.codecs,
        badge: meta.badge,
      };

      const existing = byHeight.get(stdH);
      if (!existing) {
        byHeight.set(stdH, candidate);
      } else {
        const preferNew =
          (!existing.audioUrl === false && isCombined) ||
          (isMp4 && !existing.codec?.includes('avc1') && f.codecs?.includes('avc1'));
        if (preferNew) {
          byHeight.set(stdH, candidate);
        }
      }
    }

    const sortedFormats = Array.from(byHeight.values()).sort((a, b) => (b.height || 0) - (a.height || 0));

    if (bestAudio?.url) {
      sortedFormats.push({
        id: `yt-mp3-${bestAudio.itag || 'audio'}`,
        label: 'MP3 (320kbps Audio)',
        resolution: 'MP3',
        ext: 'mp3',
        type: 'audio',
        url: bestAudio.url,
        needsMuxing: false,
        needsAudioTranscode: true,
        filesize: bestAudioSize,
        codec: bestAudio.codecs || 'mp4a',
        badge: `${bestAudio.audioBitrate || 160}kbps MP3`,
      });
    }

    if (sortedFormats.length > 0) {
      const thumb =
        details.thumbnails?.[details.thumbnails.length - 1]?.url ||
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

      return {
        id: videoId,
        url: canonicalUrl,
        platform: 'youtube',
        title: details.title || 'YouTube Video',
        author: details.author?.name || 'YouTube Creator',
        duration: Number(details.lengthSeconds || 0),
        thumbnail: thumb,
        formats: sortedFormats,
        resolverEngine: 'YouTube Direct DASH Resolver',
      };
    }
  } catch {
    // Proceed to Strategy 1B (InnerTube VR API)
  }

  // Strategy 1B: Direct YouTube InnerTube Player API (ANDROID_VR client)
  try {
    const innertubeRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12; en_US; Quest 2; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID_VR',
            clientVersion: '1.56.21',
            androidSdkVersion: 32,
            hl: 'ar',
            gl: 'US',
          },
        },
      }),
    });

    if (innertubeRes.ok) {
      const data = await innertubeRes.json();
      const streamingData = data?.streamingData;
      const videoDetails = data?.videoDetails;

      if (streamingData) {
        const allFormats = [
          ...(streamingData.formats || []),
          ...(streamingData.adaptiveFormats || []),
        ];

        const audioStreams = allFormats
          .filter(
            (f: Record<string, unknown>) =>
              typeof f.mimeType === 'string' &&
              f.mimeType.startsWith('audio/') &&
              typeof f.url === 'string'
          )
          .sort(
            (a: Record<string, unknown>, b: Record<string, unknown>) =>
              (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0)
          );

        const bestAudio = audioStreams[0];
        const bestAudioSize = bestAudio?.contentLength
          ? parseInt(String(bestAudio.contentLength), 10)
          : undefined;
        const byHeight = new Map<number, MediaFormatOption>();

        for (const f of allFormats) {
          if (
            typeof f.url !== 'string' ||
            typeof f.mimeType !== 'string' ||
            !f.mimeType.startsWith('video/')
          ) {
            continue;
          }
          const stdH = snapToStandardHeight(Number(f.height || 0));
          if (!stdH || !ALLOWED_HEIGHTS.includes(stdH)) continue;

          const isCombined = Boolean(f.audioQuality);
          const streamSize = f.contentLength ? parseInt(String(f.contentLength), 10) : undefined;
          const totalSize =
            streamSize && !isCombined && bestAudioSize ? streamSize + bestAudioSize : streamSize;
          const meta = RESOLUTION_LABELS[stdH];

          const option: MediaFormatOption = {
            id: `yt-vr-${stdH}p-${f.itag}`,
            label: `${meta.resolution} MP4`,
            resolution: meta.resolution,
            height: stdH,
            ext: 'mp4',
            type: 'video',
            url: f.url,
            audioUrl: !isCombined && bestAudio ? String(bestAudio.url) : undefined,
            needsMuxing: !isCombined && Boolean(bestAudio?.url),
            filesize: totalSize,
            fps: Number(f.fps) || 30,
            badge: meta.badge,
          };

          if (!byHeight.has(stdH) || isCombined) {
            byHeight.set(stdH, option);
          }
        }

        const formats = Array.from(byHeight.values()).sort((a, b) => (b.height || 0) - (a.height || 0));
        if (bestAudio?.url) {
          formats.push({
            id: 'yt-vr-mp3',
            label: 'MP3 (320kbps Audio)',
            resolution: 'MP3',
            ext: 'mp3',
            type: 'audio',
            url: String(bestAudio.url),
            needsMuxing: false,
            needsAudioTranscode: true,
            filesize: bestAudioSize,
            badge: '320kbps MP3',
          });
        }

        if (formats.length > 0) {
          return {
            id: videoId,
            url: canonicalUrl,
            platform: 'youtube',
            title: videoDetails?.title || 'YouTube Video',
            author: videoDetails?.author || 'YouTube Channel',
            duration: parseInt(videoDetails?.lengthSeconds || '0', 10),
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            formats,
            resolverEngine: 'YouTube InnerTube VR Engine',
          };
        }
      }
    }
  } catch {
    // Proceed to Strategy 1C (Piped / Invidious)
  }

  // Strategy 1C: Piped API Instances
  for (const instance of PIPED_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const videoStreams = Array.isArray(data.videoStreams) ? data.videoStreams : [];
      const audioStreams = Array.isArray(data.audioStreams) ? data.audioStreams : [];
      const bestAudio = audioStreams[0];

      const byHeight = new Map<number, MediaFormatOption>();
      for (const vs of videoStreams) {
        if (!vs.url) continue;
        const rawH =
          parseInt(String(vs.quality || '').replace(/\D/g, ''), 10) || Number(vs.height || 0);
        const stdH = snapToStandardHeight(rawH);
        if (!stdH || !ALLOWED_HEIGHTS.includes(stdH)) continue;

        const isVideoOnly = Boolean(vs.videoOnly);
        const meta = RESOLUTION_LABELS[stdH];
        if (!byHeight.has(stdH) || !isVideoOnly) {
          byHeight.set(stdH, {
            id: `piped-${stdH}p`,
            label: `${meta.resolution} MP4`,
            resolution: meta.resolution,
            height: stdH,
            ext: 'mp4',
            type: 'video',
            url: vs.url,
            audioUrl: isVideoOnly && bestAudio?.url ? bestAudio.url : undefined,
            needsMuxing: isVideoOnly && Boolean(bestAudio?.url),
            filesize: Number(vs.contentLength) || undefined,
            fps: Number(vs.fps) || 30,
            badge: meta.badge,
          });
        }
      }

      const formats = Array.from(byHeight.values()).sort((a, b) => (b.height || 0) - (a.height || 0));
      if (bestAudio?.url) {
        formats.push({
          id: 'piped-mp3',
          label: 'MP3 (320kbps Audio)',
          resolution: 'MP3',
          ext: 'mp3',
          type: 'audio',
          url: bestAudio.url,
          needsMuxing: false,
          needsAudioTranscode: true,
          filesize: Number(bestAudio.contentLength) || undefined,
          badge: '320kbps MP3',
        });
      }

      if (formats.length > 0) {
        return {
          id: videoId,
          url: canonicalUrl,
          platform: 'youtube',
          title: data.title || 'YouTube Video',
          author: data.uploader || 'YouTube Creator',
          duration: Number(data.duration) || 0,
          thumbnail: data.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          formats,
          resolverEngine: `Piped Node (${new URL(instance).hostname})`,
        };
      }
    } catch {
      continue;
    }
  }

  // Strategy 1D: Invidious API Instances
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const allFormats = [...(data.formatStreams || []), ...(data.adaptiveFormats || [])];
      const audioOnly = (data.adaptiveFormats || []).find((f: Record<string, unknown>) =>
        String(f.type || '').startsWith('audio/')
      );

      const byHeight = new Map<number, MediaFormatOption>();
      for (const f of allFormats) {
        if (!f.url || String(f.type || '').startsWith('audio/')) continue;
        const rawH = parseInt(String(f.qualityLabel || f.resolution || '').replace(/\D/g, ''), 10);
        const stdH = snapToStandardHeight(rawH);
        if (!stdH || !ALLOWED_HEIGHTS.includes(stdH)) continue;

        const isProgressive = (data.formatStreams || []).includes(f);
        const meta = RESOLUTION_LABELS[stdH];
        if (!byHeight.has(stdH) || isProgressive) {
          byHeight.set(stdH, {
            id: `inv-${stdH}p`,
            label: `${meta.resolution} MP4`,
            resolution: meta.resolution,
            height: stdH,
            ext: 'mp4',
            type: 'video',
            url: f.url,
            audioUrl: !isProgressive && audioOnly?.url ? audioOnly.url : undefined,
            needsMuxing: !isProgressive && Boolean(audioOnly?.url),
            filesize: Number(f.clen) || undefined,
            badge: meta.badge,
          });
        }
      }

      const formats = Array.from(byHeight.values()).sort((a, b) => (b.height || 0) - (a.height || 0));
      if (audioOnly?.url) {
        formats.push({
          id: 'inv-mp3',
          label: 'MP3 (320kbps Audio)',
          resolution: 'MP3',
          ext: 'mp3',
          type: 'audio',
          url: audioOnly.url,
          needsMuxing: false,
          needsAudioTranscode: true,
          filesize: Number(audioOnly.clen) || undefined,
          badge: '320kbps MP3',
        });
      }

      if (formats.length > 0) {
        return {
          id: videoId,
          url: canonicalUrl,
          platform: 'youtube',
          title: data.title || 'YouTube Video',
          author: data.author || 'YouTube Creator',
          duration: Number(data.lengthSeconds) || 0,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          formats,
          resolverEngine: `Invidious Node (${new URL(instance).hostname})`,
        };
      }
    } catch {
      continue;
    }
  }

  // Strategy 1E: Cobalt API Cluster Fallback
  return await extractViaCobaltCluster(canonicalUrl, 'youtube', videoId);
}

// ============================================================================
// 2. TIKTOK EXTRACTOR (Cobalt Cluster + TikWM Multi-Quality HD/SD/MP3 Engine)
// ============================================================================
async function extractTikTok(url: string): Promise<ExtractedMediaResult> {
  try {
    const formBody = new URLSearchParams({ url, hd: '1' });
    const res = await fetch('https://www.tikwm.com/api/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      body: formBody.toString(),
    });

    if (res.ok) {
      const json = await res.json();
      if (json.code === 0 && json.data) {
        const d = json.data;
        const formats: MediaFormatOption[] = [];

        if (d.hdplay) {
          const hdUrl = d.hdplay.startsWith('http') ? d.hdplay : `https://www.tikwm.com${d.hdplay}`;
          formats.push({
            id: 'tiktok-1080p-hd',
            label: '1080p MP4 (بدون علامة مائية HD)',
            resolution: '1080p',
            height: 1080,
            ext: 'mp4',
            type: 'video',
            url: hdUrl,
            needsMuxing: false,
            filesize: Number(d.hd_size) || undefined,
            badge: 'Full HD No Watermark',
          });
        }

        if (d.play) {
          const sdUrl = d.play.startsWith('http') ? d.play : `https://www.tikwm.com${d.play}`;
          formats.push({
            id: 'tiktok-720p',
            label: '720p MP4 (بدون علامة مائية)',
            resolution: '720p',
            height: 720,
            ext: 'mp4',
            type: 'video',
            url: sdUrl,
            needsMuxing: false,
            filesize: Number(d.size) || undefined,
            badge: 'HD No Watermark',
          });
        }

        if (d.wmplay) {
          const wmUrl = d.wmplay.startsWith('http') ? d.wmplay : `https://www.tikwm.com${d.wmplay}`;
          formats.push({
            id: 'tiktok-480p-wm',
            label: '480p MP4 (مع العلامة المائية)',
            resolution: '480p',
            height: 480,
            ext: 'mp4',
            type: 'video',
            url: wmUrl,
            needsMuxing: false,
            filesize: Number(d.wm_size) || undefined,
            badge: 'Watermarked SD',
          });
        }

        if (d.music) {
          const musicUrl = d.music.startsWith('http') ? d.music : `https://www.tikwm.com${d.music}`;
          const audioSize = await probeStreamSize(musicUrl, 'https://www.tiktok.com/');
          formats.push({
            id: 'tiktok-mp3',
            label: 'MP3 (الصوت الأصلي 320kbps)',
            resolution: 'MP3',
            ext: 'mp3',
            type: 'audio',
            url: musicUrl,
            needsMuxing: false,
            needsAudioTranscode: false,
            filesize: audioSize,
            badge: 'Original MP3',
          });
        }

        if (formats.length > 0) {
          const coverUrl = d.cover?.startsWith('http')
            ? d.cover
            : d.origin_cover?.startsWith('http')
              ? d.origin_cover
              : `https://www.tikwm.com${d.cover || ''}`;

          return {
            id: String(d.id || Date.now()),
            url,
            platform: 'tiktok',
            title: d.title || `TikTok Video by @${d.author?.unique_id || 'creator'}`,
            author: d.author?.nickname || d.author?.unique_id || 'TikTok Creator',
            duration: Number(d.duration) || 0,
            thumbnail: coverUrl,
            formats,
            resolverEngine: 'TikTok Direct Stream Engine',
          };
        }
      }
    }
  } catch {
    // Fallback to Cobalt cluster
  }

  return await extractViaCobaltCluster(url, 'tiktok');
}

// ============================================================================
// 3. X / TWITTER EXTRACTOR (Syndication Multi-Bitrate + vxTwitter + Cobalt API)
// ============================================================================
async function extractTwitter(url: string): Promise<ExtractedMediaResult> {
  const match = url.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status\/(\d+)/i);
  const tweetId = match?.[2];
  const username = match?.[1] || 'user';

  if (tweetId) {
    try {
      const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
      const syndRes = await fetch(
        `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=ar&token=${token}`,
        {
          headers: { 'User-Agent': USER_AGENT },
        }
      );

      if (syndRes.ok) {
        const syndData = await syndRes.json();
        const mediaDetails = syndData.mediaDetails || [];
        const videoMedia = mediaDetails.find(
          (m: Record<string, unknown>) => m.type === 'video' || m.type === 'animated_gif'
        );

        if (videoMedia && videoMedia.video_info?.variants) {
          const variants = (videoMedia.video_info.variants as Array<Record<string, unknown>>).filter(
            (v) => v.content_type === 'video/mp4' && typeof v.url === 'string'
          );

          const byHeight = new Map<number, MediaFormatOption>();

          for (const v of variants) {
            const vUrl = String(v.url);
            const resMatch = vUrl.match(/\/(\d+)x(\d+)\//);
            let stdH: number | null = null;
            if (resMatch) {
              const w = parseInt(resMatch[1], 10);
              const h = parseInt(resMatch[2], 10);
              const smallerDim = Math.min(w, h);
              stdH = snapToStandardHeight(smallerDim);
            }
            if (!stdH) {
              const br = Number(v.bitrate || 0);
              if (br >= 2000000) stdH = 1080;
              else if (br >= 800000) stdH = 720;
              else if (br >= 400000) stdH = 480;
              else stdH = 360;
            }

            if (!ALLOWED_HEIGHTS.includes(stdH)) continue;
            const meta = RESOLUTION_LABELS[stdH];
            const probedSize = await probeStreamSize(vUrl, 'https://x.com/');

            byHeight.set(stdH, {
              id: `x-${stdH}p`,
              label: `${meta.resolution} MP4`,
              resolution: meta.resolution,
              height: stdH,
              ext: 'mp4',
              type: 'video',
              url: vUrl,
              needsMuxing: false,
              filesize: probedSize,
              badge: meta.badge,
            });
          }

          const formats = Array.from(byHeight.values()).sort((a, b) => (b.height || 0) - (a.height || 0));
          if (formats.length > 0) {
            const bestVideo = formats[0];
            formats.push({
              id: 'x-mp3',
              label: 'MP3 (استخراج الصوت 320kbps)',
              resolution: 'MP3',
              ext: 'mp3',
              type: 'audio',
              url: bestVideo.url,
              needsMuxing: false,
              needsAudioTranscode: true,
              filesize: bestVideo.filesize ? Math.round(bestVideo.filesize * 0.18) : undefined,
              badge: '320kbps MP3',
            });

            return {
              id: tweetId,
              url,
              platform: 'twitter',
              title: syndData.text ? String(syndData.text).slice(0, 90) : `X Video by @${username}`,
              author: syndData.user?.name || `@${username}`,
              duration: Math.round(Number(videoMedia.video_info.duration_millis || 0) / 1000),
              thumbnail: String(videoMedia.media_url_https || ''),
              formats,
              resolverEngine: 'X Syndication Multi-Bitrate Resolver',
            };
          }
        }
      }
    } catch {
      // Proceed to vxTwitter
    }

    try {
      const vxRes = await fetch(`https://api.vxtwitter.com/${username}/status/${tweetId}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (vxRes.ok) {
        const vxData = await vxRes.json();
        const mediaExtended = Array.isArray(vxData.media_extended) ? vxData.media_extended : [];
        const videoItem = mediaExtended.find(
          (m: Record<string, unknown>) => m.type === 'video' || m.type === 'gif'
        );

        if (videoItem && videoItem.url) {
          const vUrl = String(videoItem.url);
          const rawH = Math.min(
            Number(videoItem.size?.width || 720),
            Number(videoItem.size?.height || 720)
          );
          const stdH = snapToStandardHeight(rawH) || 720;
          const meta = RESOLUTION_LABELS[stdH];
          const filesize = await probeStreamSize(vUrl, 'https://x.com/');

          const formats: MediaFormatOption[] = [
            {
              id: `vx-${stdH}p`,
              label: `${meta.resolution} MP4`,
              resolution: meta.resolution,
              height: stdH,
              ext: 'mp4',
              type: 'video',
              url: vUrl,
              needsMuxing: false,
              filesize,
              badge: meta.badge,
            },
            {
              id: 'vx-mp3',
              label: 'MP3 (استخراج الصوت 320kbps)',
              resolution: 'MP3',
              ext: 'mp3',
              type: 'audio',
              url: vUrl,
              needsMuxing: false,
              needsAudioTranscode: true,
              filesize: filesize ? Math.round(filesize * 0.18) : undefined,
              badge: '320kbps MP3',
            },
          ];

          return {
            id: tweetId,
            url,
            platform: 'twitter',
            title: vxData.text ? String(vxData.text).slice(0, 90) : `X Video by @${username}`,
            author: vxData.user_name || `@${username}`,
            duration: Math.round(Number(videoItem.duration_millis || 0) / 1000),
            thumbnail: String(videoItem.thumbnail_url || ''),
            formats,
            resolverEngine: 'vxTwitter Direct Stream Resolver',
          };
        }
      }
    } catch {
      // Fallback to Cobalt cluster
    }
  }

  return await extractViaCobaltCluster(url, 'twitter', tweetId);
}

// ============================================================================
// 4. FACEBOOK EXTRACTOR (Direct HD/SD Manifest Scraping + Cobalt API Fallback)
// ============================================================================
async function extractFacebook(url: string): Promise<ExtractedMediaResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Sec-Fetch-Mode': 'navigate',
      },
      redirect: 'follow',
    });

    if (res.ok) {
      const html = await res.text();
      const decodeFbUrl = (raw?: string) => {
        if (!raw) return null;
        try {
          return JSON.parse(`"${raw}"`).replace(/\\\//g, '/').replace(/&amp;/g, '&');
        } catch {
          return raw.replace(/\\\//g, '/').replace(/&amp;/g, '&');
        }
      };

      const hdMatch =
        html.match(/"browser_native_hd_url"\s*:\s*"([^"]+)"/) ||
        html.match(/"playable_url_quality_hd"\s*:\s*"([^"]+)"/) ||
        html.match(/hd_src\s*:\s*"([^"]+)"/);

      const sdMatch =
        html.match(/"browser_native_sd_url"\s*:\s*"([^"]+)"/) ||
        html.match(/"playable_url"\s*:\s*"([^"]+)"/) ||
        html.match(/sd_src\s*:\s*"([^"]+)"/);

      const titleMatch =
        html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
        html.match(/<title>([^<]+)<\/title>/i);

      const thumbMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);

      const hdUrl = decodeFbUrl(hdMatch?.[1]);
      const sdUrl = decodeFbUrl(sdMatch?.[1]);

      const formats: MediaFormatOption[] = [];

      if (hdUrl && hdUrl.startsWith('http')) {
        const hdSize = await probeStreamSize(hdUrl, 'https://www.facebook.com/');
        formats.push({
          id: 'fb-1080p-hd',
          label: '1080p MP4 (جودة عالية HD)',
          resolution: '1080p',
          height: 1080,
          ext: 'mp4',
          type: 'video',
          url: hdUrl,
          needsMuxing: false,
          filesize: hdSize,
          badge: 'Full HD',
        });
      }

      if (sdUrl && sdUrl.startsWith('http')) {
        const sdSize = await probeStreamSize(sdUrl, 'https://www.facebook.com/');
        formats.push({
          id: 'fb-480p-sd',
          label: '480p MP4 (جودة قياسية SD)',
          resolution: '480p',
          height: 480,
          ext: 'mp4',
          type: 'video',
          url: sdUrl,
          needsMuxing: false,
          filesize: sdSize,
          badge: 'SD',
        });
      }

      if (formats.length > 0) {
        const primaryVideo = formats[0];
        formats.push({
          id: 'fb-mp3',
          label: 'MP3 (استخراج الصوت 320kbps)',
          resolution: 'MP3',
          ext: 'mp3',
          type: 'audio',
          url: primaryVideo.url,
          needsMuxing: false,
          needsAudioTranscode: true,
          filesize: primaryVideo.filesize ? Math.round(primaryVideo.filesize * 0.16) : undefined,
          badge: '320kbps MP3',
        });

        return {
          id: `fb-${Date.now()}`,
          url,
          platform: 'facebook',
          title:
            titleMatch?.[1]?.replace(/&#039;/g, "'").replace(/&quot;/g, '"') || 'Facebook Video',
          author: 'Facebook Creator',
          duration: 0,
          thumbnail: decodeFbUrl(thumbMatch?.[1]) || '',
          formats,
          resolverEngine: 'Facebook Native HD/SD Stream Parser',
        };
      }
    }
  } catch {
    // Fallback to Cobalt cluster
  }

  return await extractViaCobaltCluster(url, 'facebook');
}

// ============================================================================
// 5. INSTAGRAM EXTRACTOR (Embed Stream Parser + Cobalt API Cluster Fallback)
// ============================================================================
async function extractInstagram(url: string): Promise<ExtractedMediaResult> {
  const shortcodeMatch = url.match(/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  const shortcode = shortcodeMatch?.[1];

  if (shortcode) {
    try {
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      const res = await fetch(embedUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (res.ok) {
        const html = await res.text();
        const videoUrlMatch =
          html.match(/"video_url"\s*:\s*"([^"]+)"/) ||
          html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i);

        const thumbMatch =
          html.match(/"display_url"\s*:\s*"([^"]+)"/) ||
          html.match(/<img\s+class="EmbeddedMediaImage"[^>]+src="([^"]+)"/i);

        const usernameMatch = html.match(/"username"\s*:\s*"([^"]+)"/);

        if (videoUrlMatch?.[1]) {
          const cleanVideoUrl = videoUrlMatch[1]
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&');

          const cleanThumbUrl = (thumbMatch?.[1] || '')
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&');

          const size = await probeStreamSize(cleanVideoUrl, 'https://www.instagram.com/');

          return {
            id: shortcode,
            url,
            platform: 'instagram',
            title: `Instagram Reel / Video (@${usernameMatch?.[1] || shortcode})`,
            author: usernameMatch?.[1] ? `@${usernameMatch[1]}` : 'Instagram Creator',
            duration: 0,
            thumbnail: cleanThumbUrl,
            formats: [
              {
                id: 'ig-1080p',
                label: '1080p MP4 (الجودة الأصلية الكاملة)',
                resolution: '1080p',
                height: 1080,
                ext: 'mp4',
                type: 'video',
                url: cleanVideoUrl,
                needsMuxing: false,
                filesize: size,
                badge: 'Original Full HD',
              },
              {
                id: 'ig-mp3',
                label: 'MP3 (استخراج الصوت 320kbps)',
                resolution: 'MP3',
                ext: 'mp3',
                type: 'audio',
                url: cleanVideoUrl,
                needsMuxing: false,
                needsAudioTranscode: true,
                filesize: size ? Math.round(size * 0.16) : undefined,
                badge: '320kbps MP3',
              },
            ],
            resolverEngine: 'Instagram Direct Embed Stream Parser',
          };
        }
      }
    } catch {
      // Fallback to Cobalt cluster
    }
  }

  return await extractViaCobaltCluster(url, 'instagram', shortcode);
}

// ============================================================================
// 6. DIRECT MEDIA PROBER (Direct .mp4 / .mp3 / .webm URLs)
// ============================================================================
async function extractDirectMedia(url: string): Promise<ExtractedMediaResult> {
  const size = await probeStreamSize(url);
  const isAudio = /\.(mp3|m4a|wav|ogg|aac)(\?|$)/i.test(url);
  const parsed = new URL(url);
  const rawName = decodeURIComponent(parsed.pathname.split('/').pop() || 'Direct Media Stream');

  const formats: MediaFormatOption[] = isAudio
    ? [
        {
          id: 'direct-mp3',
          label: 'MP3 (320kbps Audio)',
          resolution: 'MP3',
          ext: 'mp3',
          type: 'audio',
          url,
          needsMuxing: false,
          filesize: size,
          badge: 'Direct Audio',
        },
      ]
    : [
        {
          id: 'direct-1080p',
          label: '1080p MP4 (البث المباشر الأصلي)',
          resolution: '1080p',
          height: 1080,
          ext: 'mp4',
          type: 'video',
          url,
          needsMuxing: false,
          filesize: size,
          badge: 'Direct Stream',
        },
        {
          id: 'direct-mp3',
          label: 'MP3 (استخراج الصوت 320kbps)',
          resolution: 'MP3',
          ext: 'mp3',
          type: 'audio',
          url,
          needsMuxing: false,
          needsAudioTranscode: true,
          filesize: size ? Math.round(size * 0.16) : undefined,
          badge: '320kbps MP3',
        },
      ];

  return {
    id: `direct-${Date.now()}`,
    url,
    platform: 'direct',
    title: rawName,
    author: parsed.hostname,
    duration: 0,
    thumbnail: '',
    formats,
    resolverEngine: 'Direct HTTP Range Prober',
  };
}

// ============================================================================
// MAIN POST HANDLER (/api/extract)
// ============================================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawUrl = String(body.url || '').trim();
    const ignorePlaylist = Boolean(body.ignorePlaylist);

    if (!rawUrl) {
      return NextResponse.json({ error: 'يرجى إدخال رابط فيديو أو صوت صحيح.' }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return NextResponse.json(
        { error: 'صيغة الرابط غير صالحة. تأكد من بدء الرابط بـ https://' },
        { status: 400 }
      );
    }

    const platform = detectPlatform(parsedUrl.toString());

    // 1. Detect YouTube Playlist URLs (containing `list=` parameter)
    const playlistId =
      platform === 'youtube' && !ignorePlaylist
        ? extractYouTubePlaylistId(parsedUrl.toString())
        : null;

    if (playlistId) {
      try {
        const playlistResult = await extractYouTubePlaylist(parsedUrl.toString(), 50);
        return NextResponse.json(playlistResult, { status: 200 });
      } catch (playlistErr: unknown) {
        // If URL also contains a specific video ID (`v=`), fallback to single video extraction
        const singleVideoId = extractYouTubeVideoId(parsedUrl.toString());
        if (!singleVideoId) {
          const msg =
            playlistErr instanceof Error
              ? playlistErr.message
              : 'تعذر استخراج قائمة التشغيل من يوتيوب.';
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }
    }

    // 2. Single Video / Audio Extraction
    let result: ExtractedMediaResult;

    switch (platform) {
      case 'youtube':
        result = await extractYouTube(parsedUrl.toString());
        break;
      case 'tiktok':
        result = await extractTikTok(parsedUrl.toString());
        break;
      case 'twitter':
        result = await extractTwitter(parsedUrl.toString());
        break;
      case 'facebook':
        result = await extractFacebook(parsedUrl.toString());
        break;
      case 'instagram':
        result = await extractInstagram(parsedUrl.toString());
        break;
      default:
        result = await extractDirectMedia(parsedUrl.toString());
        break;
    }

    // Probe file sizes for top formats missing filesize in parallel
    await Promise.allSettled(
      result.formats.slice(0, 5).map(async (fmt) => {
        if (!fmt.filesize && fmt.url) {
          fmt.filesize = await probeStreamSize(fmt.url);
        }
      })
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء فحص الرابط واستخراج الجودات.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
