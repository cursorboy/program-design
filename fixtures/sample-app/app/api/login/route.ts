import { db } from '../../../lib/db';

export async function POST(request: Request) {
  const url = process.env.DATABASE_URL;
  const body = await request.json();
  const user = await db.user.findUnique({ where: { email: body.email } });
  const created = await db.user.create({ data: { email: body.email } });
  return Response.json({ ok: Boolean(url) && Boolean(user) && Boolean(created) });
}
