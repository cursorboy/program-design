import Link from 'next/link';

export function Nav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/login">Log in</Link>
      <Link href="/about">About</Link>
      <Link href="/blog/hello">Blog</Link>
      <a href="https://example.com">Docs</a>
    </nav>
  );
}
