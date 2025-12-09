import Image, { StaticImageData } from 'next/image';
import { useTheme } from 'next-themes';

export default function SectionBanner({
  image,
  title,
  subtitle,
  height = 160,
  darkOverlay = 0.4,
  mode,
}: {
  image: StaticImageData | string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  height?: number;
  darkOverlay?: number; // 0..1
  mode?: 'light' | 'dark'; // optional override; defaults to theme
}) {
  const { resolvedTheme } = useTheme();
  const isDark = mode ? mode === 'dark' : resolvedTheme !== 'light';
  const resolvedHeight = typeof height === 'number' ? `${height}px` : height;
  const overlayAlpha = isDark ? darkOverlay : 0.15; // lighten overlay in light mode
  const lightGradient = 'from-[#e54152] via-[#d92b3c] to-[#e75b66]';

  return (
    <div
      className={`relative overflow-hidden mb-6 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.25)] ${
        isDark ? 'border border-white/10' : 'border border-red-200/80'
      }`}
      style={{ height: resolvedHeight, minHeight: resolvedHeight }}
    >
      <div
        aria-hidden
        className={`absolute inset-0 ${isDark ? 'opacity-30 bg-gradient-to-r from-[#190104] via-[#36000b] to-[#130005]' : `opacity-90 bg-gradient-to-r ${lightGradient}`}`}
      />
      <Image
        src={image}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: `rgba(0,0,0,${overlayAlpha})` }}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${
          isDark
            ? 'bg-gradient-to-br from-black/70 via-red-900/20 to-black/65'
            : 'bg-gradient-to-br from-white/65 via-red-200/35 to-white/30'
        }`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,0,90,0.16),_transparent_55%)] ${
          isDark ? 'opacity-70' : 'opacity-65'
        }`}
      />
      <div className="relative z-10 h-full flex items-center px-6 md:px-8">
        <div>
          <h2 className={`text-2xl md:text-3xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h2>
          {subtitle ? (
            <p className={`mt-2 text-sm md:text-base ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>{subtitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
