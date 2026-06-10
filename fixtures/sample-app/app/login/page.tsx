import Link from 'next/link';
import { LoginForm } from '../../components/LoginForm';

export default function LoginPage() {
  return (
    <main>
      <h1>Login</h1>
      <LoginForm />
      <Link href="/">Back home</Link>
    </main>
  );
}
