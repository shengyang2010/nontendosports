# Nontendo Sports 🎳⛳

A two-player party sports game with **Bowling** and **Golf**. The laptop is the screen, and phones are the controllers.

Nothing to install: it only needs **Node.js 18 or newer**.

```bash
node server.js        # or: npm start
npm test              # scoring, physics and server tests
```

## How to play

1. Run `node server.js` on the laptop and open **http://localhost:3000**.
2. Scan the QR code with a phone and tap **Start**. Up to two phones can join.
3. Pick **Bowling** or **Golf** on the laptop, then click **Start game**.
4. No phone? Click **Practise with the keyboard**. Press **Space** to play; in golf, the **arrow keys** aim and change club.

### Pausing and quitting
- **Laptop:** click **❚❚ Menu** (bottom left) or press **Esc**.
- **Phone:** tap **❚❚ Menu** at the bottom of the controller.
- Either one pauses the game for everyone and shows **Resume**, **Restart** and **Quit to lobby**. Quitting returns everyone to the lobby so you can pick another sport.

### 🎳 Bowling
- **Swing mode** (HTTPS only):
  1. Hold the phone **like a TV remote**: screen facing up, top pointing at the laptop.
  2. **Tilt left or right to aim.** A dashed line on the laptop shows where the ball will go.
  3. **Press and hold** the button, **swing your arm**, and **let go** as your arm comes forward.
  4. A harder swing gives more power. **Twist your wrist** as you let go to curve the ball.
- **Touch mode**: flick up the pad. A faster flick gives more power; curve the end of the swipe for spin.

### ⛳ Golf (3 holes: par 3, par 4 dogleg, par 5 with a creek)
- **Swing mode** (HTTPS only):
  1. **Hold the phone like a club grip** with both hands: top pointing at the floor, screen facing you. Stand side-on like a golfer.
  2. Use **⟲ ⟳** to aim and **◀ ▶** to change club. The game picks a sensible club for you each shot.
  3. **Press and hold** the screen with your thumbs and keep holding.
  4. **Swing back.** The further back you go, the more power. The power meter and the yellow target on the laptop move as you swing. Past 100% you get extra distance but less accuracy.
  5. **Swing through.** The ball is hit automatically as the phone passes where you started. A lazy downswing tops the ball.
  6. Keep the phone face **square** to hit straight. Twisting it during the swing hooks or slices. If the curve goes the wrong way for you, tick **Reverse curve**.
  7. On the green you get the **putter**: same motion, much smaller swing.
- **Touch mode**: drag down the pad to power up, then flick back up to hit. Drifting sideways on the flick curves the ball.
- Rules: the player farthest from the hole plays next. Water and out of bounds cost a penalty stroke. Watch the wind. Lowest total wins.

## Getting swing controls (HTTPS)

Phones only share motion-sensor data with HTTPS pages. Over plain `http://` on your Wi-Fi, the controller switches to swipe mode automatically. For swing mode, put the game behind a tunnel:

```bash
# terminal 1
node server.js
# terminal 2 (either one)
cloudflared tunnel --url http://localhost:3000
ngrok http 3000
```

Then restart the server with the tunnel URL so the QR code points at it:

```bash
PUBLIC_URL=https://your-tunnel-url.trycloudflare.com node server.js
```

Deploying to Render, Railway or Fly also gives you HTTPS. The start command is `node server.js`, and they set `PORT` automatically.

## Files

| File | What it does |
|---|---|
| `server.js` | Static file server, built-in WebSocket and room relay (no npm packages) |
| `public/host.html` / `host.js` | Laptop: lobby, sport picker, QR code, pop-ups, confetti, game-over screen |
| `public/games/bowling.js` | Bowling turn flow and scoreboard |
| `public/games/golf.js` | Golf turn flow, top-down course view, power meter, scorecard |
| `public/golf.js` | Golf course data, clubs, ball flight, roll and putting (pure JS, tested) |
| `public/render.js` | Pseudo-3D lane, pins and ball drawn on a canvas |
| `public/physics.js` | Ball, hook and pin physics (pure JS, tested in Node) |
| `public/scoring.js` | Ten-pin scoring, including strikes, spares and the 10th frame |
| `public/controller.html` / `controller.js` | Phone controller for both sports: motion and touch modes, reconnects, vibration |
| `test/` | `node --test` suites |

## Tuning motion controls

Open the controller with `?log=1` added to the URL, for example `/play?room=ABCD&log=1`. Bowl some practice throws, then tap the result line on the phone (or run `downloadCsv()`) to save `swings.csv`. Settings are at the top of `controller.js`:
- Bowling: `POWER_MIN` / `POWER_MAX` (swing speed), `AIM_TILT_MAX_DEG` (tilt for full aim).
- Golf: `GOLF_FULL_DEG` (backswing angle for 100% power), `PUTT_FULL_DEG`, `GOLF_FACE_MAX_DEG` (face twist for a full hook/slice).

Lane difficulty settings are in `physics.js`: how far the ball hooks (`spin * 0.9`), the aim angle (`aim * 0.03`), and the pin fall thresholds.

## Notes

- The QR code is drawn by a small library loaded from a CDN. If the laptop is offline, the join link is shown as text instead.
- Phones keep their player slot if they reload or lose Wi-Fi briefly, because they rejoin with a saved token.
- The look is inspired by bright party-sports games, but all art, colours and code are original. It contains no Nintendo assets.
- The project folder is still called `bowling-party` so your setup (and `cloudflared.exe`) works the same way.
