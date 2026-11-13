import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getPlatformReferer(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('tiktok') || host.includes('tiktokcdn') || host.includes('musical.ly') || host.includes('tikwm')) {
      return 'https://www.tiktok.com/';
    }
    if (host.includes('fbcdn') || host.includes('facebook')) {
      return 'https://www.facebook.com/';
    }
    if (host.includes('cdninstagram') || host.includes('instagram')) {
      return 'https://www.instagram.com/';
    }
    if (host.includes('twimg') || host.includes('twitter') || host.includes('x.com')) {
      return 'https://x.com/';
    }
    if (host.includes('googlevideo') || host.includes('youtube')) {
      return 'https://www.youtube.com/';
    }
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return 'https://www.google.com/';
  }
}

function buildCorsHeaders(extra: Record<string, string> = {}): Headers {
  const headers = new Headers(extra);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin');
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition, X-Accept-Ranges'
  );
  return headers;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(),
  });
}

export async function HEAD(req: NextRequest) {
  const targetUrl = req.nextUrl.searchParams.get('url');
  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400, headers: buildCorsHeaders() });
  }

  try {
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: '*/*',
      Referer: getPlatformReferer(targetUrl),
    };

    // First try HEAD, then fallback to GET with Range: bytes=0-0 if upstream rejects HEAD
    let upstreamRes = await fetch(targetUrl, {
      method: 'HEAD',
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    let totalSize = upstreamRes.headers.get('content-length');
    let acceptRanges = upstreamRes.headers.get('accept-ranges') || '';

    if (!upstreamRes.ok || !totalSize || totalSize === '0') {
      const rangeProbe = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          ...upstreamHeaders,
          Range: 'bytes=0-0',
        },
        redirect: 'follow',
      });

      if (rangeProbe.ok || rangeProbe.status === 206) {
        const contentRange = rangeProbe.headers.get('content-range');
        if (contentRange && contentRange.includes('/')) {
          const totalPart = contentRange.split('/')[1];
          if (totalPart && totalPart !== '*') {
            totalSize = totalPart;
          }
        }
        if (!totalSize) {
          totalSize = rangeProbe.headers.get('content-length');
        }
        if (rangeProbe.status === 206) {
          acceptRanges = 'bytes';
        }
        upstreamRes = rangeProbe;
      }
      // Abort probe body immediately
      try {
        await rangeProbe.body?.cancel();
      } catch {
        // Ignore stream cancel errors
      }
    }

    const responseHeaders = buildCorsHeaders();
    if (totalSize) {
      responseHeaders.set('Content-Length', totalSize);
    }
    responseHeaders.set('Accept-Ranges', acceptRanges || 'bytes');
    responseHeaders.set('X-Accept-Ranges', acceptRanges || 'bytes');
    responseHeaders.set('Content-Type', upstreamRes.headers.get('content-type') || 'application/octet-stream');

    return new NextResponse(null, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Proxy HEAD error';
    return NextResponse.json({ error: message }, { status: 502, headers: buildCorsHeaders() });
  }
}

export async function GET(req: NextRequest) {
  const targetUrl = req.nextUrl.searchParams.get('url');
  const filename = req.nextUrl.searchParams.get('filename');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400, headers: buildCorsHeaders() });
  }

  try {
    const rangeHeader = req.headers.get('range') || req.nextUrl.searchParams.get('range');
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      Referer: getPlatformReferer(targetUrl),
    };

    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader.startsWith('bytes=') ? rangeHeader : `bytes=${rangeHeader}`;
    }

    const upstreamRes = await fetch(targetUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: req.signal,
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      return NextResponse.json(
        { error: `Upstream server responded with HTTP ${upstreamRes.status}` },
        { status: upstreamRes.status, headers: buildCorsHeaders() }
      );
    }

    const responseHeaders = buildCorsHeaders();
    const contentType = upstreamRes.headers.get('content-type') || 'video/mp4';
    const contentLength = upstreamRes.headers.get('content-length');
    const contentRange = upstreamRes.headers.get('content-range');
    const acceptRanges = upstreamRes.headers.get('accept-ranges') || (upstreamRes.status === 206 ? 'bytes' : 'none');

    responseHeaders.set('Content-Type', contentType);
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange);
    }
    responseHeaders.set('Accept-Ranges', acceptRanges);
    responseHeaders.set('Cache-Control', 'no-store, no-transform');

    if (filename) {
      const safeAscii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
      const encodedName = encodeURIComponent(filename);
      responseHeaders.set(
        'Content-Disposition',
        `attachment; filename="${safeAscii || 'media.mp4'}"; filename*=UTF-8''${encodedName}`
      );
    }

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Streaming proxy failed';
    return NextResponse.json({ error: message }, { status: 502, headers: buildCorsHeaders() });
  }
}
