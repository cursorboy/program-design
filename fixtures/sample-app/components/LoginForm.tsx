'use client';

import { useState } from 'react';

export function LoginForm() {
  const [email, setEmail] = useState('');

  async function onSubmit() {
    await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Log in</button>
    </form>
  );
}
