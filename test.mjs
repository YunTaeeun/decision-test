import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { buildRequest, decide, defaultWeights } from "./decisions.mjs";
import { createApp } from "./server.mjs";
const E = createRequire(import.meta.url)("./public/engine.js");
const state = () => ({ board: E.empty(), current: "I", next: "T" });
const mock = async (url, options) => {
  assert.equal(url, "https://api.openai.com/v1/decisions");
  const req = JSON.parse(options.body);
  assert.equal(req.model, "gpt-6-luna");
  assert.equal(req.questions[0].type, "choice");
  const choice = req.questions[0].choices.find(
    (c) =>
      JSON.parse(c.description).column === 4 &&
      JSON.parse(c.description).rotation === 0,
  ).value;
  return Response.json({
    answers: [
      {
        type: "choice",
        name: "tetris_move",
        choice,
        confidence: 0.87,
        probabilities: [{ value: choice, probability: 0.91 }],
      },
    ],
  });
};
test("choice schema supplies every legal move in unranked stable order", () => {
  const { request, candidates } = buildRequest(state());
  assert.equal(
    candidates.length,
    E.evaluate(E.empty(), "I", defaultWeights).length,
  );
  assert.equal(
    new Set(request.questions[0].choices.map((c) => c.value)).size,
    candidates.length,
  );
  assert.equal(candidates[0].rotation, 0);
  assert.equal(candidates[0].x, 0);
  assert.equal(request.model, "gpt-6-luna");
  assert.equal(typeof request.input, "string");
});
test("selected API action is legal, preserves probabilities, measures duration", async () => {
  const result = await decide(state(), {
    apiKey: "test-only",
    fetchImpl: mock,
  });
  assert.deepEqual(result.move, { x: 3, rotation: 0 });
  assert.equal(result.confidence, 0.87);
  assert.equal(result.probabilities[0].probability, 0.91);
  assert.ok(result.apiMs >= 0);
  const chosen = E.evaluate(E.empty(), "I", defaultWeights).find(
    (c) => c.x === 3 && c.rotation === 0,
  );
  assert.equal(chosen.board[19].filter(Boolean).length, 4);
});
test("missing key, malformed state, refusal, unknown move and HTTP errors stop play", async () => {
  await assert.rejects(
    () => decide(state()),
    (e) => e.status === 503,
  );
  assert.throws(
    () => buildRequest({ ...state(), board: [] }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () =>
      decide(state(), {
        apiKey: "test-only",
        fetchImpl: async () =>
          Response.json({
            answers: [{ type: "refusal", name: "tetris_move" }],
          }),
      }),
    /거부/,
  );
  await assert.rejects(
    () =>
      decide(state(), {
        apiKey: "test-only",
        fetchImpl: async () =>
          Response.json({ answers: [{ type: "choice", choice: "invalid" }] }),
      }),
    /합법적/,
  );
  await assert.rejects(
    () =>
      decide(state(), {
        apiKey: "test-only",
        fetchImpl: async () => new Response("", { status: 429 }),
      }),
    (e) => e.status === 429,
  );
});
test("line clear and reproducible bags; seeded games preserve board shape", () => {
  const board = E.empty();
  board[19] = Array(10).fill("J");
  for (let i = 3; i < 7; i++) board[19][i] = 0;
  const best = E.evaluate(board, "I", defaultWeights)[0];
  assert.equal(best.lines, 1);
  assert.equal(best.x, 3);
  const a = E.bag(E.rng(123)),
    b = E.bag(E.rng(123));
  for (let i = 0; i < 70; i++) assert.equal(a(), b());
  const bag = E.bag(E.rng(2));
  assert.equal(new Set(Array.from({ length: 7 }, () => bag())).size, 7);
  for (let seed = 1; seed <= 10; seed++) {
    let board = E.empty(),
      draw = E.bag(E.rng(seed));
    for (let i = 0; i < 300; i++) {
      const c = E.evaluate(board, draw(), defaultWeights);
      if (!c.length) break;
      board = c[0].board;
      assert.equal(board.length, 20);
      assert.ok(board.every((r) => r.length === 10));
      assert.ok(Number.isFinite(c[0].value));
    }
  }
});
test("custom decision rules reach the actual choice question", () => {
  const rules = "Prefer a four-line clear and preserve a right-side well.";
  const { request } = buildRequest({ ...state(), rules });
  assert.ok(request.questions[0].instructions.includes(rules));
  assert.throws(
    () => buildRequest({ ...state(), rules: "x" }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => buildRequest({ ...state(), rules: "x".repeat(2001) }),
    (e) => e.status === 400,
  );
});
async function withServer(options, run) {
  const server = createApp(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test("BYOK HTTP flow forwards only the current visitor key and returns legal placement", async () => {
  const seen = [];
  await withServer(
    {
      fetchImpl: async (url, opts) => {
        seen.push(opts.headers.Authorization);
        assert.ok(
          JSON.parse(opts.body).questions[0].instructions.includes(
            "Keep a low stack.",
          ),
        );
        return mock(url, opts);
      },
    },
    async (base) => {
      const page = await fetch(base);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Decision Playground/);
      for (const key of [
        "test-user-secret-key-one",
        "test-user-secret-key-two",
      ]) {
        const r = await fetch(base + "/api/decision", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...state(), rules: "Keep a low stack." }),
        });
        assert.equal(r.status, 200);
        const result = await r.json();
        assert.deepEqual(result.move, { x: 3, rotation: 0 });
        assert.ok(!JSON.stringify(result).includes(key));
      }
      assert.deepEqual(seen, [
        "Bearer test-user-secret-key-one",
        "Bearer test-user-secret-key-two",
      ]);
    },
  );
});
test("missing key, malformed payload, cross origin, and oversized input are rejected", async () => {
  await withServer({}, async (base) => {
    const post = (body, headers = {}) =>
      fetch(base + "/api/decision", { method: "POST", body, headers });
    assert.equal((await post(JSON.stringify(state()))).status, 401);
    const headers = { Authorization: "Bearer test-user-secret-key" };
    assert.equal((await post("invalid", headers)).status, 400);
    assert.equal(
      (await post("{}", { ...headers, Origin: "https://unrelated.example" }))
        .status,
      403,
    );
    assert.equal((await post("x".repeat(18000), headers)).status, 413);
    assert.equal((await fetch(base + "/api/decision")).status, 405);
  });
});
test("Vercel adapter accepts parsed bodies and never returns the API key", async () => {
  const { handleDecision } = await import("./endpoint.mjs");
  const { EventEmitter } = await import("node:events");
  const req = {
    method: "POST",
    headers: {
      authorization: "Bearer test-user-secret-key",
      host: "play.example",
      "x-forwarded-proto": "https",
      origin: "https://play.example",
    },
    body: state(),
  };
  const res = new EventEmitter();
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
    res.headersSent = true;
  };
  res.end = (body) => {
    res.body = body;
    res.writableEnded = true;
  };
  await handleDecision(req, res, { fetchImpl: mock });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).source, "openai-decisions");
  assert.ok(!res.body.includes("test-user-secret-key"));
});
test("frontend sends the edited rule, freezes a run, saves comparisons without credentials, and preserves board on API failure", async () => {
  const { readFile } = await import("node:fs/promises"),
    vm = await import("node:vm");
  const defaults = {
    mode: "api",
    preset: "balanced",
    seedinput: "202610",
    limit: "2",
    speed: "5",
    apikey: "test-visitor-private-key",
  };
  class Element {
    constructor(id = "") {
      this.id = id;
      this.value = defaults[id] || "";
      this.style = {};
      this.children = [];
      this.disabled = false;
      this.classList = { toggle() {} };
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    setAttribute() {}
    getContext() {
      return new Proxy({}, { get: () => () => {}, set: () => true });
    }
    click() {}
  }
  const elements = new Map(),
    stored = new Map(),
    get = (id) => {
      if (!elements.has(id)) elements.set(id, new Element(id));
      return elements.get(id);
    };
  let captured,
    fail = false,
    exportBlob;
  const context = vm.createContext({
    document: {
      getElementById: get,
      createElement: () => new Element(),
      createTextNode: (t) => ({ textContent: t }),
    },
    localStorage: {
      getItem: (k) => stored.get(k) || null,
      setItem: (k, v) => stored.set(k, v),
    },
    performance,
    crypto,
    AbortController,
    Blob,
    URL: {
      createObjectURL: (b) => {
        exportBlob = b;
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    setTimeout,
    clearTimeout,
    window: { scrollTo() {} },
    fetch: async (url, opts) => {
      assert.equal(url, "/api/decision");
      captured = JSON.parse(opts.body);
      assert.equal(
        opts.headers.Authorization,
        "Bearer test-visitor-private-key",
      );
      if (fail)
        return Response.json({ error: "Rejected test key" }, { status: 401 });
      return Response.json(
        await decide(captured, {
          apiKey: "test-visitor-private-key",
          fetchImpl: mock,
        }),
      );
    },
  });
  await vm.runInContext(
    await readFile(new URL("./public/engine.js", import.meta.url), "utf8"),
    context,
  );
  context.Tetris = context.window.Tetris;
  vm.runInContext(
    await readFile(new URL("./public/app.js", import.meta.url), "utf8"),
    context,
  );
  get("rules").value = "Keep a low stack. Clear complete lines.";
  get("rulename").value = "Custom strategy";
  await vm.runInContext("step()", context);
  assert.equal(captured.rules, get("rules").value);
  assert.equal(get("rules").disabled, true);
  assert.equal(get("pieces").textContent, 1);
  await vm.runInContext("step()", context);
  assert.equal(get("pieces").textContent, 2);
  assert.ok(stored.size > 0);
  const records = JSON.parse(stored.get("decision-playground-experiments-v1"));
  assert.equal(records[0].name, "Custom strategy");
  assert.equal(records[0].phase, "complete");
  assert.ok(!JSON.stringify(records).includes("test-visitor-private-key"));
  get("export").onclick();
  assert.ok(!(await exportBlob.text()).includes("test-visitor-private-key"));
  get("reset").onclick();
  assert.equal(get("rules").disabled, false);
  assert.equal(get("pieces").textContent, 0);
  assert.equal(get("seedlabel").textContent, 202610);
  fail = true;
  await vm.runInContext("step()", context);
  assert.equal(get("pieces").textContent, 0);
  assert.match(get("connection").textContent, /Rejected/);
  assert.equal(vm.runInContext("history.length", context), 0);
  get("reset").onclick();
  get("mode").value = "demo";
  get("mode").onchange();
  await vm.runInContext("step()", context);
  assert.equal(get("pieces").textContent, 1);
  assert.equal(vm.runInContext("history[0].source", context), "local-demo");
});
