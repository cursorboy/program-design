export function withAuth<T extends (...args: any[]) => any>(handler: T): T {
  return handler;
}
