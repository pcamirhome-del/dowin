import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sizeParam = parseInt(searchParams.get('size') || '512', 10);
  const size = [180, 192, 512].includes(sizeParam) ? sizeParam : 512;
  const maskable = searchParams.get('maskable') === 'true';

  const padding = maskable ? Math.round(size * 0.16) : Math.round(size * 0.08);
  const strokeWidth = Math.max(8, Math.round(size * 0.065));

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #070B19 0%, #0F172A 55%, #083344 100%)',
          borderRadius: maskable ? '0px' : `${Math.round(size * 0.22)}px`,
          padding: `${padding}px`,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: `${Math.round(size * 0.18)}px`,
            border: '4px solid rgba(34, 211, 238, 0.35)',
            background: 'rgba(15, 23, 42, 0.75)',
            boxShadow: '0 0 40px rgba(6, 182, 212, 0.35)',
          }}
        >
          <svg
            width={Math.round(size * 0.52)}
            height={Math.round(size * 0.52)}
            viewBox="0 0 256 256"
            fill="none"
          >
            <path
              d="M128 36V172M128 172L72 116M128 172L184 116"
              stroke="#22D3EE"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M56 212H200"
              stroke="#38BDF8"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
    }
  );
}
