// Ten-pin bowling scoring. Pure functions, shared by the host page and the tests.

// Split a flat list of rolls into 10 frames.
export function splitFrames(rolls) {
  const frames = [];
  let i = 0;
  for (let f = 0; f < 10; f++) {
    const start = i;
    let r;
    if (f < 9) {
      r = rolls[i] === 10 ? [10] : rolls.slice(i, i + 2);
    } else {
      r = rolls.slice(i, i + 3);
      if (r.length >= 2 && r[0] + r[1] < 10) r = r.slice(0, 2); // open 10th: no bonus ball
    }
    i += r.length;
    frames.push({ start, rolls: r });
  }
  return frames;
}

function frameComplete(fr, f) {
  const r = fr.rolls;
  if (f < 9) return r[0] === 10 || r.length === 2;
  return r.length === 3 || (r.length === 2 && r[0] + r[1] < 10);
}

// Returns { frames:[{rolls, marks, cum}], total, done }
// cum is null until the frame's score is known (strike/spare bonuses pending).
export function scoreGame(rolls) {
  const frames = splitFrames(rolls);
  let total = 0, known = true;
  const out = frames.map((fr, f) => {
    const r = fr.rolls, s = fr.start;
    let value = null;
    if (f < 9) {
      if (r[0] === 10) {
        if (rolls.length > s + 2) value = 10 + rolls[s + 1] + rolls[s + 2];
      } else if (r.length === 2 && r[0] + r[1] === 10) {
        if (rolls.length > s + 2) value = 10 + rolls[s + 2];
      } else if (r.length === 2) value = r[0] + r[1];
    } else if (frameComplete(fr, 9)) {
      value = r.reduce((a, b) => a + b, 0);
    }
    if (value === null) known = false;
    if (known) total += value;
    return { rolls: r, marks: marks(r, f === 9), cum: known ? total : null };
  });
  return { frames: out, total, done: frameComplete(frames[9], 9) };
}

// Display marks: X strike, / spare, - miss.
export function marks(r, tenth) {
  const m = [];
  let fresh = true; // is a full rack standing before this ball?
  for (let i = 0; i < r.length; i++) {
    const v = r[i];
    if (fresh && v === 10) { m.push("X"); fresh = true; }
    else if (!fresh && r[i - 1] + v === 10) { m.push("/"); fresh = true; }
    else { m.push(v === 0 ? "-" : String(v)); fresh = !fresh; }
    if (!tenth && m[0] === "X") break;
  }
  return m;
}

// What happens on the next roll: { done, frame, ball, standing }
// standing === 10 means a fresh rack must be set.
export function nextRoll(rolls) {
  const frames = splitFrames(rolls);
  const f = frames.findIndex((fr, i) => !frameComplete(fr, i));
  if (f === -1) return { done: true };
  const r = frames[f].rolls, ball = r.length;
  let standing = 10;
  if (f < 9) {
    if (ball === 1) standing = 10 - r[0];
  } else {
    if (ball === 1) standing = r[0] === 10 ? 10 : 10 - r[0];
    if (ball === 2) {
      if (r[0] === 10) standing = r[1] === 10 ? 10 : 10 - r[1];
      else standing = 10; // spare in 10th: fresh rack
    }
  }
  return { done: false, frame: f, ball, standing };
}

// Label for the pop-up after a roll.
export function rollLabel(knocked, standingBefore, ball) {
  if (knocked === 10 && standingBefore === 10) return "STRIKE!";
  if (knocked === standingBefore && knocked > 0) return "SPARE!";
  if (knocked === 0) return ball === 0 || standingBefore === 10 ? "Gutter..." : "Miss";
  return `${knocked} pin${knocked === 1 ? "" : "s"}`;
}
