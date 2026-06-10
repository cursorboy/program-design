'use client';

export function Dynamic({ endpoint }: { endpoint: string }) {
  async function load() {
    const res = await fetch(`/api/${endpoint}`);
    return res.json();
  }

  return <button onClick={load}>Load</button>;
}
