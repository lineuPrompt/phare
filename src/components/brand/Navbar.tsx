import Logo from './Logo';
import LanguageSwitcher from './LanguageSwitcher';
import AuthButton from './AuthButton';

export default function Navbar() {
  return (
    <nav
      className="w-full flex items-center justify-between px-6 py-4"
      style={{ borderBottom: '1px solid #E5E7EB' }}
    >
      <Logo />
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <AuthButton />
      </div>
    </nav>
  );
}