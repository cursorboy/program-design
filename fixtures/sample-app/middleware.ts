import { withAuth } from './lib/withAuth';

export default withAuth(function middleware(request: Request) {
  return undefined;
});

export const config = {
  matcher: ['/api/:path*'],
};
