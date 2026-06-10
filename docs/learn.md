# System design, gently

You don't need a computer-science degree to understand how your own app is put
together. You just need one good picture in your head. Here's the one we use
everywhere in program-design: **your app is a restaurant.**

Once you have the restaurant in your head, the real engineering words stop being
scary — they're just labels for parts you already understand. Let's walk the
whole place, front to back.

## The restaurant, end to end

**The front counter — your pages (the "frontend").**
This is everything a customer sees and touches: the menu, the counter, the person
taking the order. In your app, that's your *pages* — the screens people tap on.
The front counter never cooks anything itself. Its whole job is to take what the
customer wants and pass it back to the kitchen.

**The kitchen — your back end (the "backend").**
Behind the counter is the kitchen, where the real work happens. Customers never
walk in here. In your app this is the *back end*: the code that actually does
things — checks passwords, saves orders, runs the logic. Most confusing bugs are
really just the counter and the kitchen disagreeing about an order.

**The doors — your endpoints (also called "routes").**
The counter and the kitchen talk through specific doors. Each door takes one kind
of order: a "place an order" door, a "check my order" door. In your app these are
*endpoints*. When a page needs something done, it goes to a particular door and
hands over a ticket. If a door is missing, the order has nowhere to go — that
feature just quietly fails.

**The order ticket — a request (a "client call").**
The little slip the counter hands through the door is a *request*. One ticket =
one ask. Following a single ticket from the counter, through a door, to the cook
who fills it is exactly how you prove a feature is really connected — not just
sketched on the menu.

**The doorkeeper — your security guard (called "middleware").**
Some doors have a doorkeeper who checks every ticket before it reaches a cook:
"Are you a real customer? Are you allowed to order this?" In your app that's
*middleware*. It runs *before* the endpoint does its work. It's how you keep the
wrong people out of the right doors.

**The filing cabinets — your records (a "database table").**
The kitchen keeps filing cabinets in the back: one drawer for customers, one for
orders, one for receipts. These are your *database tables*. Each drawer holds one
kind of thing. This is your app's long-term memory — the one part you really
don't want to lose or mislabel.

**The recipe book — your blueprint (the "schema").**
Every dish follows a recipe with a fixed list of ingredients. The *schema* is that
recipe book for your records: it says a "customer" always has a name, an email, a
sign-up date. When the recipe book and the actual drawers drift apart, your data
quietly goes bad.

**The pantry suppliers — your building blocks (called "dependencies").**
You don't grow your own tomatoes. Outside suppliers deliver ingredients you didn't
make yourself. In your app those are *dependencies* — ready-made code other people
wrote that you install and use. Handy, but everything they deliver still ends up
in your dishes, so it's worth knowing what's in the crate.

**The sticky notes with door codes — your settings & secrets (called "environment
variables").**
The manager keeps a few secrets on sticky notes in the office: the safe code, the
supplier's password. They're never printed on the menu. In your app those are
*environment variables* — passwords and keys kept *outside* the code, different on
each machine. If a secret ends up on the menu, anyone can read it.

## Now the real words

You already understand all of it. Here are the labels engineers use, and where
program-design points them out in your own app:

| Friendly name | Technical term | Where you see it in program-design |
|---|---|---|
| Front counter | frontend | The pages in your flow strips (Plain level) |
| Kitchen | backend | Everything behind your endpoints |
| Page | page / frontend route | The first chip in a flow strip |
| Endpoint | route / API endpoint | The `/api/...` chip in a flow strip |
| Order ticket | request / client call | The "sends info to" arrow between chips |
| Security guard | middleware | The "checked by the security guard" chip |
| Records | database table | The "saved in your … records" chip |
| Blueprint | schema | The shape behind those records |
| Building blocks | dependencies | Listed in the Map and Technical levels |
| Settings & secrets | environment variables | The env-var nodes in the Map diagram |

The three depth levels are the same restaurant at three zoom levels. **Plain**
walks you through tickets in plain sentences. **Map** is the floor plan — the
diagram of every door, cabinet, and guard. **Technical** is the clipboard with
every measurement: confidence tiers, rule ids, raw file-and-line receipts.

One promise that never changes, at every level: this tool **verifies presence, not
correctness.** It confirms a door *exists* and a ticket *reaches* it. It does not
taste the food. "The login door is wired up" is something we can prove from your
code. "The login actually checks the password correctly" is not — that's a
behavior, and behavior needs tests, not a structure check.

## Read your own app — 5 short exercises

Open the demo (`program-design demo`) and try these. Each one turns a friendly
chip into a real engineering idea.

1. **Follow one ticket.** On the Plain level, pick any flow strip and read it left
   to right: page → sends info to → endpoint. You just traced a request from
   frontend to backend. Tap the endpoint chip and hit "Show me the code" — that
   file-and-line is the real door.

2. **Find a guarded door.** Look for a flow with a "checked by the security guard"
   chip. That's middleware proven to run before the endpoint. Now flip to
   Technical and notice the confidence tier — that's *how* we know the guard is
   attached, not just that one exists somewhere.

3. **Spot your app's memory.** Find a flow ending in "saved in your … records."
   Switch to Map and find that same table in the diagram (the cabinet shape).
   You've now seen the same fact as a sentence *and* as a floor plan.

4. **Catch an honest "I don't know."** Look for a flow that ends with "somewhere I
   can't trace." That's a request whose destination is built at runtime, so the
   code alone can't prove where it lands. Notice the tool says so plainly instead
   of guessing — that honesty is the whole point.

5. **Read the secrets list.** On the Map level, find the environment-variable
   nodes. Those are the sticky notes with door codes your code reads. Ask
   yourself: should every one of these really be a secret, and is any of them
   accidentally on the menu?

That's the whole restaurant. Same building, three zoom levels, and a tool that
only ever tells you what it can actually see in your code — builder to builder.
