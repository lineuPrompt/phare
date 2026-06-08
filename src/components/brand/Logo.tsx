import Image from 'next/image';

export default function Logo({ className = '' }: { className?: string }) {
  return (
    <a href="/" className="flex items-center">
      <Image
        src="/assets/logo_phare_line.png"
        alt="Phare.money"
        width={180}
        height={48}
        style={{ width: 'auto', height: '108px' }}
        className={className}
        priority
        unoptimized
      />
    </a>
  );
}