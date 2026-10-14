import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  E = require("./public/engine.js");
export const defaultWeights = { lines: 8, height: 0.5, holes: 3.5, bump: 0.3 };
export class DecisionError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export function validateState(state) {
  if (
    !state ||
    !Array.isArray(state.board) ||
    state.board.length !== 20 ||
    !state.board.every(
      (r) =>
        Array.isArray(r) &&
        r.length === 10 &&
        r.every((v) => v === 0 || Object.hasOwn(E.shapes, v)),
    )
  )
    throw new DecisionError("유효한 10×20 보드가 필요합니다.", 400);
  if (
    !Object.hasOwn(E.shapes, state.current) ||
    !Object.hasOwn(E.shapes, state.next)
  )
    throw new DecisionError("블록 종류가 유효하지 않습니다.", 400);
}
export const defaultRules =
  "Survive as long as possible. Clear lines, avoid holes, keep the stack low and the surface smooth. Consider the next piece.";
export function buildRequest(state) {
  validateState(state);
  if (
    state.rules !== undefined &&
    (typeof state.rules !== "string" ||
      state.rules.length > 2000 ||
      state.rules.trim().length < 5)
  )
    throw new DecisionError("규칙은 5~2000자로 입력하세요.", 400);
  // Stable position order avoids giving the model a heuristic pre-ranking.
  const candidates = E.evaluate(
    state.board,
    state.current,
    defaultWeights,
  ).sort((a, b) => a.rotation - b.rotation || a.x - b.x);
  const summary = (c) => ({
    column: c.x + 1,
    rotation: c.rotation,
    landingRow: c.y + 1,
    clearedLines: c.lines,
    holes: c.holes,
    totalHeight: c.aggregate,
    maxHeight: c.height,
    bumpiness: c.bump,
  });
  const request = {
    model: "gpt-6-luna",
    input: JSON.stringify({
      game: "Tetris",
      columns: 10,
      rows: 20,
      boardTopToBottom: state.board.map((r) =>
        r.map((v) => (v ? "#" : ".")).join(""),
      ),
      current: state.current,
      next: state.next,
      candidates: candidates.map((c, i) => ({
        id: "move_" + i,
        ...summary(c),
      })),
    }),
    questions: [
      {
        type: "choice",
        name: "tetris_move",
        instructions:
          "Choose the legal placement that best supports long-term Tetris survival and line clearing. All moves are legal hard drops from the top without wall kicks or hold. The candidate order carries no preference. Select exactly one supplied move. Apply the following player strategy when selecting a move: " +
          (state.rules?.trim() || defaultRules),
        choices: candidates.map((c, i) => ({
          value: "move_" + i,
          description: JSON.stringify(summary(c)),
        })),
      },
    ],
  };
  return { request, candidates };
}
export async function decide(
  state,
  { apiKey, fetchImpl = fetch, signal } = {},
) {
  if (!apiKey)
    throw new DecisionError("본인의 OpenAI API 키를 입력하세요.", 503);
  const { request, candidates } = buildRequest(state);
  if (!candidates.length)
    throw new DecisionError("배치 가능한 후보가 없습니다.", 409);
  const start = performance.now();
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: signal ?? AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new DecisionError(
      e.name === "TimeoutError" || e.name === "AbortError"
        ? "모델 요청 시간이 초과되었거나 취소되었습니다."
        : "OpenAI에 연결하지 못했습니다. 서버 네트워크를 확인하세요.",
      504,
    );
  }
  if (!response.ok)
    throw new DecisionError(
      `OpenAI API 요청 실패 (HTTP ${response.status}). API 키, Decisions 접근 권한 및 사용 한도를 확인하세요.`,
      response.status === 429 ? 429 : 502,
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new DecisionError("OpenAI 응답을 해석하지 못했습니다.");
  }
  const apiMs = performance.now() - start;
  const answer =
    data.answers?.find((a) => a.name === "tetris_move") ?? data.answers?.[0];
  if (answer?.type === "refusal")
    throw new DecisionError("모델이 이번 의사결정을 거부했습니다.");
  if (answer?.type !== "choice")
    throw new DecisionError("모델이 예상한 choice 응답을 반환하지 않았습니다.");
  const index = request.questions[0].choices.findIndex(
    (c) => c.value === answer.choice,
  );
  if (index < 0)
    throw new DecisionError("모델 응답에 합법적 후보가 포함되지 않았습니다.");
  const probabilities = Array.isArray(answer.probabilities)
    ? answer.probabilities
        .filter(
          (p) =>
            request.questions[0].choices.some((c) => c.value === p.value) &&
            Number.isFinite(p.probability) &&
            p.probability >= 0 &&
            p.probability <= 1,
        )
        .map((p) => ({ value: p.value, probability: p.probability }))
    : [];
  const chosen = candidates[index];
  return {
    model: request.model,
    source: "openai-decisions",
    move: { x: chosen.x, rotation: chosen.rotation },
    choice: answer.choice,
    confidence:
      Number.isFinite(answer.confidence) &&
      answer.confidence >= 0 &&
      answer.confidence <= 1
        ? answer.confidence
        : null,
    probabilities,
    candidates: candidates.map((c, i) => ({
      id: "move_" + i,
      x: c.x,
      rotation: c.rotation,
      lines: c.lines,
      holes: c.holes,
      aggregate: c.aggregate,
      bump: c.bump,
    })),
    apiMs,
  };
}
