'use client';

import { helper } from './DoesNotExist';

export function Broken() {
  return <div>{helper()}</div>;
}
