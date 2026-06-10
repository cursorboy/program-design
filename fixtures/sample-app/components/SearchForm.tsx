'use client';

import { useState } from 'react';

export function SearchForm({ host }: { host: string }) {
  const [q, setQuery] = useState('');

  async function onSubmit() {
    // Dynamic destination — built at runtime, so we can't trace where it goes.
    await fetch(`https://${host}/search?q=${q}`, { method: 'POST' });
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={q} onChange={(e) => setQuery(e.target.value)} />
      <button type="submit">Search</button>
    </form>
  );
}
