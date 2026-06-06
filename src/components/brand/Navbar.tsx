import Logo from './Logo';
import LanguageSwitcher from './LanguageSwitcher';

export default function Navbar() {
  return (
    <nav
      className="w-full flex items-center justify-between px-6 py-4"
      style={{ borderBottom: '1px solid #E5E7EB' }}
    >
      <Logo />
      <LanguageSwitcher />
    </nav>
  );
}