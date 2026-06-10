import { db } from '../../../lib/db';

export async function POST(request: Request) {
  const { email } = await request.json();
  const user = await db.user.create({ data: { email } });
  return Response.json({ id: user.id });
}
