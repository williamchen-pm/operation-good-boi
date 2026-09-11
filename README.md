# Operation Good Boi

A browser-based top-down stealth game where you rescue a kidnapped puppy from a warehouse.

## How to play

- **Move:** WASD or Arrow Keys
- **Goal:** Sneak in, find the puppy (walk into it to pick it up), and bring it back to the door you came in through.
- **You lose if:** a guard's vision cone spots you, or you touch a guard.

Finish as fast as you can and submit your time to the leaderboard.

## Tech stack

- [Phaser 3](https://phaser.io/) for rendering, input, and lighting
- [Vite](https://vite.dev/) for the dev server and build
- [Supabase](https://supabase.com/) for the leaderboard
- Deployed on [Vercel](https://vercel.com/)

## Features

- **Guard patrol AI.** Guards patrol and spread out across the map. They are caught by vision cones with line-of-sight occlusion, so props block what guards can see.
- **Feet-based collision.** Collision uses boxes measured from each sprite's feet and props' alpha-derived footprints, with Y-sort depth layering so characters walk in front of and behind objects correctly.
- **Dynamic lighting.** Wall lamps and a spotlight on the puppy light the warehouse, and guards dim in the dark.
- **Leaderboard.** Weekly and monthly boards, fetched at most once a day through a local cache.
- **Anti-cheat time validation.** Runs faster than a minimum possible time are rejected before they are submitted.

## Local setup

Requires [Node.js](https://nodejs.org/) (a current LTS release).

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173/). `npm run build` produces a production build in `dist/`.

The leaderboard connects to the project's Supabase instance with its public publishable key. Access is limited by the table's Row Level Security policies (public read and insert only).

## Credits

- **Environment art and characters:** *Retro Cybercity STREETS Tileset* and *Retro Cybercity Street Characters* by [everlyspixelsandpens](https://everlywritesgames.itch.io/), purchased.
- **Dog sprite:** by [Admurin](https://admurin.itch.io/).

**Asset license note:** these art and sprite assets are licensed by their original creators for use in this project. They are **not** covered by this repository's MIT license and may not be extracted, reused, or redistributed as standalone assets. To use them in your own work, get them from the creators.

## License

The **source code** is released under the [MIT License](LICENSE). The MIT license applies to the code only; the art and sprite assets are excluded, as described under Credits.
