import Image, { StaticImageData } from 'next/image';

export default function SectionBanner({
  image,
  title,
  subtitle,
  height = 160,
  darkOverlay = 0.4,
}: {
  image: StaticImageData | string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  height?: number;
  darkOverlay?: number; // 0..1
}) {
  const resolvedHeight = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className="relative overflow-hidden rounded-2xl mb-6"
      style={{ height: resolvedHeight, minHeight: resolvedHeight }}
    >
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
        style={{ backgroundColor: `rgba(0,0,0,${darkOverlay})` }}
      />
      <div className="relative z-10 h-full flex items-center px-6 md:px-8">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-white">{title}</h2>
          {subtitle ? (
            <p className="mt-2 text-sm md:text-base text-gray-200">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
