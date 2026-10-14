(function (root) {
  const shapes = {
    I: [[1, 1, 1, 1]],
    O: [
      [1, 1],
      [1, 1],
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
    ],
    J: [
      [1, 0, 0],
      [1, 1, 1],
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1],
    ],
  };
  const colors = {
    I: "#6bcee1",
    O: "#edcc68",
    T: "#ad8fe3",
    S: "#b5f277",
    Z: "#e78285",
    J: "#769ded",
    L: "#eaaa6e",
  };
  const rotate = (s) => s[0].map((_, x) => s.map((r) => r[x]).reverse());
  function rotations(type) {
    let s = shapes[type],
      a = [],
      seen = new Set();
    for (let i = 0; i < 4; i++) {
      const key = JSON.stringify(s);
      if (!seen.has(key)) {
        seen.add(key);
        a.push({ shape: s, rotation: i * 90 });
      }
      s = rotate(s);
    }
    return a;
  }
  function fits(board, s, x, y) {
    return s.every((row, dy) =>
      row.every(
        (v, dx) =>
          !v ||
          (x + dx >= 0 &&
            x + dx < 10 &&
            y + dy >= 0 &&
            y + dy < 20 &&
            !board[y + dy][x + dx]),
      ),
    );
  }
  function features(board) {
    const heights = Array(10).fill(0);
    let holes = 0;
    for (let x = 0; x < 10; x++) {
      let occupied = false;
      for (let y = 0; y < 20; y++) {
        if (board[y][x]) {
          if (!occupied) heights[x] = 20 - y;
          occupied = true;
        } else if (occupied) holes++;
      }
    }
    return {
      height: Math.max(...heights),
      aggregate: heights.reduce((a, b) => a + b, 0),
      holes,
      bump: heights
        .slice(1)
        .reduce((n, h, i) => n + Math.abs(h - heights[i]), 0),
    };
  }
  function evaluate(board, type, w) {
    let out = [];
    for (const { shape, rotation } of rotations(type)) {
      for (let x = 0; x <= 10 - shape[0].length; x++) {
        if (!fits(board, shape, x, 0)) continue;
        let y = 0;
        while (fits(board, shape, x, y + 1)) y++;
        let result = board.map((r) => r.slice());
        shape.forEach((r, dy) =>
          r.forEach((v, dx) => {
            if (v) result[y + dy][x + dx] = type;
          }),
        );
        const kept = result.filter((r) => !r.every(Boolean));
        const lines = 20 - kept.length;
        while (kept.length < 20) kept.unshift(Array(10).fill(0));
        const f = features(kept),
          value =
            w.lines * lines -
            w.height * f.aggregate -
            w.holes * f.holes -
            w.bump * f.bump;
        out.push({ x, y, shape, rotation, board: kept, lines, ...f, value });
      }
    }
    return out.sort(
      (a, b) => b.value - a.value || b.lines - a.lines || a.x - b.x,
    );
  }
  function rng(seed) {
    let n = seed >>> 0;
    return () => {
      n = (n + 0x6d2b79f5) >>> 0;
      let t = Math.imul(n ^ (n >>> 15), n | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function bag(random) {
    let pool = [];
    return () => {
      if (!pool.length) {
        pool = Object.keys(shapes);
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
      }
      return pool.pop();
    };
  }
  const api = {
    shapes,
    colors,
    rotations,
    fits,
    features,
    evaluate,
    rng,
    bag,
    empty: () => Array.from({ length: 20 }, () => Array(10).fill(0)),
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.Tetris = api;
})(typeof window !== "undefined" ? window : globalThis);
