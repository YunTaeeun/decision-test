const $ = (id) => document.getElementById(id),
  E = Tetris;
const templates = {
  balanced: {
    name: "균형형 v1",
    rules:
      "Survive as long as possible. Clear lines while avoiding holes. Keep the aggregate height low and the surface smooth. Consider the next piece before selecting a placement.",
    weights: { lines: 8, height: 0.5, holes: 3.5, bump: 0.3 },
  },
  safe: {
    name: "생존 우선 v1",
    rules:
      "Prioritize survival. Strongly avoid creating any new covered empty cells. Minimize maximum stack height and keep the surface smooth. Clear lines when doing so does not introduce dangerous holes. Consider the next piece.",
    weights: { lines: 5, height: 0.8, holes: 6, bump: 0.7 },
  },
  attack: {
    name: "줄 제거 우선 v1",
    rules:
      "Prioritize immediate line clearing, especially multiple lines at once. Accept some surface unevenness to clear lines. Avoid excessive holes and dangerous maximum height. Consider whether the next piece can complete more lines.",
    weights: { lines: 15, height: 0.35, holes: 2.5, bump: 0.2 },
  },
};
let weights = { ...templates.balanced.weights },
  board,
  current,
  next,
  drawPiece,
  choices = [],
  running = false,
  ended = false,
  busy = false,
  timer,
  requestController,
  generation = 0,
  score = 0,
  lines = 0,
  pieces = 0,
  history = [],
  seed,
  samples = [],
  snapshot = null,
  phase = "ready",
  runId = null,
  experiments = [];
const storageKey = "decision-playground-experiments-v1";
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (Array.isArray(saved))
    experiments = saved
      .filter(
        (r) =>
          r &&
          typeof r.id === "string" &&
          typeof r.name === "string" &&
          r.name.length <= 50 &&
          typeof r.rules === "string" &&
          r.rules.length <= 2000 &&
          ["api", "demo"].includes(r.mode) &&
          Number.isInteger(r.seed) &&
          r.seed >= 1 &&
          r.seed <= 999999 &&
          Number.isInteger(r.target) &&
          r.target >= 1 &&
          r.target <= 1000 &&
          [r.score, r.lines, r.pieces, r.mean, r.p95].every(Number.isFinite),
      )
      .slice(0, 20);
} catch {}
const weightConfigs = [
  ["lines", "줄 제거 보상", 20, 0.1],
  ["height", "누적 높이 비용", 2, 0.05],
  ["holes", "빈 공간 비용", 10, 0.1],
  ["bump", "표면 굴곡 비용", 2, 0.05],
];
$("demoweights").innerHTML =
  "<p>시연은 자연어 규칙을 해석하지 않습니다. 아래 가중치로 규칙 기반 후보를 평가합니다.</p>" +
  weightConfigs
    .map(
      ([key, label, max, step]) =>
        `<div class="weight"><label for="w-${key}">${label}</label><input id="w-${key}" type="range" min="0" max="${max}" step="${step}" value="${weights[key]}"><output id="o-${key}">${weights[key].toFixed(2)}</output></div>`,
    )
    .join("");
for (const [key] of weightConfigs)
  $("w-" + key).oninput = (e) => {
    weights[key] = +e.target.value;
    $("o-" + key).textContent = weights[key].toFixed(2);
    plan();
  };
function setTemplate(key) {
  if (!templates[key]) return;
  const t = templates[key];
  $("rules").value = t.rules;
  $("rulename").value = t.name;
  weights = { ...t.weights };
  syncWeights();
  ruleCount();
}
function syncWeights() {
  for (const [key] of weightConfigs) {
    $("w-" + key).value = weights[key];
    $("o-" + key).textContent = weights[key].toFixed(2);
  }
}
function ruleCount() {
  $("rulecount").textContent = $("rules").value.length + " / 2000";
}
$("preset").onchange = () => {
  setTemplate($("preset").value);
  plan();
};
$("rules").oninput = () => {
  $("preset").value = "custom";
  ruleCount();
};
function cell(ctx, x, y, size, color, ghost = false) {
  ctx.fillStyle = ghost ? color + "22" : color;
  ctx.fillRect(x * size + 2, y * size + 2, size - 4, size - 4);
  if (ghost) {
    ctx.strokeStyle = color + "88";
    ctx.strokeRect(x * size + 2.5, y * size + 2.5, size - 5, size - 5);
  } else {
    ctx.fillStyle = "#ffffff25";
    ctx.fillRect(x * size + 3, y * size + 3, size - 6, 3);
  }
}
function render() {
  const ctx = $("board").getContext("2d");
  ctx.clearRect(0, 0, 300, 600);
  ctx.strokeStyle = "#1b2530";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= 10; x++) {
    ctx.beginPath();
    ctx.moveTo(x * 30, 0);
    ctx.lineTo(x * 30, 600);
    ctx.stroke();
  }
  for (let y = 0; y <= 20; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * 30);
    ctx.lineTo(300, y * 30);
    ctx.stroke();
  }
  board.forEach((r, y) =>
    r.forEach((v, x) => {
      if (v) cell(ctx, x, y, 30, E.colors[v]);
    }),
  );
  if ($("mode").value === "demo" && choices[0]) {
    const b = choices[0];
    b.shape.forEach((r, dy) =>
      r.forEach((v, dx) => {
        if (v) cell(ctx, b.x + dx, b.y + dy, 30, E.colors[current], true);
      }),
    );
  }
  if (!ended) {
    const s = E.shapes[current],
      offset = Math.floor((10 - s[0].length) / 2);
    if (E.fits(board, s, offset, 0))
      s.forEach((r, y) =>
        r.forEach((v, x) => {
          if (v) cell(ctx, offset + x, y, 30, E.colors[current]);
        }),
      );
  }
  const nc = $("next").getContext("2d");
  nc.clearRect(0, 0, 90, 65);
  E.shapes[next].forEach((r, y) =>
    r.forEach((v, x) => {
      if (v) cell(nc, x, y, 20, E.colors[next]);
    }),
  );
  $("score").textContent = score.toLocaleString();
  $("lines").textContent = lines;
  $("pieces").textContent = pieces;
  $("height").textContent = E.features(board).height + " / 20";
  $("count").textContent = choices.length;
  buttons();
}
function buttons() {
  const locked = !!snapshot || busy || running;
  $("step").disabled = busy || ended;
  $("play").disabled = ended || (!running && busy);
  $("play").textContent = running
    ? "Ⅱ 일시정지"
    : pieces
      ? "▶ 계속하기"
      : "▶ 실험 시작";
  for (const id of [
    "mode",
    "rules",
    "rulename",
    "preset",
    "limit",
    "seedinput",
  ])
    $(id).disabled = locked;
  for (const [key] of weightConfigs) $("w-" + key).disabled = locked;
  $("save").disabled = !pieces || busy;
  $("export").disabled = !pieces;
  $("demoweights").hidden = $("mode").value !== "demo";
}
function plan() {
  choices = E.evaluate(board, current, snapshot?.weights || weights);
  render();
}
function overlay(title, detail, error = false) {
  $("overlay").style.display = "flex";
  $("overlay").classList.toggle("error", error);
  $("overlay").replaceChildren(document.createTextNode(title));
  const small = document.createElement("small");
  small.textContent = detail;
  $("overlay").append(small);
}
function connection() {
  const api = $("mode").value === "api";
  $("connection").className =
    "connection " + (api ? ($("apikey").value.trim() ? "ok" : "") : "");
  $("connection").textContent = api
    ? $("apikey").value.trim()
      ? "키 입력됨 · 실행 시 API로 유효성을 확인합니다. API 사용료는 본인 계정에 부과됩니다."
      : "API 키를 입력하세요. 키 없이 테스트하려면 로컬 시연 모드를 선택하세요."
    : "로컬 시연 · OpenAI를 호출하지 않습니다. 자연어 규칙 대신 아래 가중치를 사용하며, 측정값은 로컬 계산 시간입니다.";
  $("demoweights").hidden = api;
}
$("apikey").oninput = connection;
$("clearkey").onclick = () => {
  $("apikey").value = "";
  connection();
};
function stats() {
  const sorted = samples.slice().sort((a, b) => a - b);
  return {
    mean: samples.length
      ? samples.reduce((a, b) => a + b, 0) / samples.length
      : 0,
    p95: samples.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : 0,
  };
}
function showLatency(result, roundTrip) {
  samples.push(roundTrip);
  $("value").textContent = Math.round(roundTrip) + " ms";
  $("apims").textContent =
    result.apiMs == null ? "해당 없음" : Math.round(result.apiMs) + " ms";
  $("confidence").textContent =
    result.confidence == null
      ? "—"
      : (result.confidence * 100).toFixed(1) + "%";
  const s = stats();
  $("average").textContent = Math.round(s.mean) + " ms";
  $("p95").textContent = Math.round(s.p95) + " ms";
  const data = samples.slice(-30),
    max = Math.max(150, ...data) * 1.1,
    point = (n, i) =>
      `${10 + (data.length === 1 ? 0 : (i * 480) / (data.length - 1))},${60 - (n / max) * 52}`,
    targetY = 60 - (100 / max) * 52;
  $("chart").innerHTML =
    `<line x1="10" y1="${targetY}" x2="490" y2="${targetY}" stroke="#46543e" stroke-dasharray="4 4"/><text x="445" y="${Math.max(9, targetY - 4)}" fill="#829b70" font-size="9">100ms</text><polyline fill="none" stroke="#b5f277" stroke-width="2" points="${data.map(point).join(" ")}"/>` +
    data
      .map((n, i) => {
        const [cx, cy] = point(n, i).split(",");
        return `<circle cx="${cx}" cy="${cy}" r="2" fill="#b5f277"/>`;
      })
      .join("");
}
function showTable(result, chosen) {
  const api = result.source === "openai-decisions";
  const probs = new Map(
    (result.probabilities ?? []).map((p) => [p.value, p.probability]),
  );
  let rows;
  if (api)
    rows = result.candidates
      .map((c) => ({
        ...c,
        probability: probs.get(c.id),
        selected: c.x === chosen.x && c.rotation === chosen.rotation,
      }))
      .sort(
        (a, b) =>
          Number(b.selected) - Number(a.selected) ||
          (b.probability ?? -1) - (a.probability ?? -1),
      )
      .slice(0, 5);
  else
    rows = choices.slice(0, 5).map((c) => ({ ...c, selected: c === chosen }));
  $("candidates").innerHTML = rows
    .map(
      (c, i) =>
        `<tr class="${c.selected ? "best" : ""}"><td>${c.selected ? "↗ " : ""}${String(i + 1).padStart(2, "0")}</td><td>${c.x + 1}열 · ${c.rotation}°</td><td>${c.lines}</td><td>${api ? (c.probability === undefined ? "—" : (c.probability * 100).toFixed(1) + "%") : "시연"}</td></tr>`,
    )
    .join("");
  $("turn").textContent = "TURN " + String(pieces).padStart(3, "0");
  $("reason").textContent =
    `${api ? "OpenAI 선택" : "로컬 규칙 선택"}: ${current} 블록 → ${chosen.x + 1}열, ${chosen.rotation}°. 착지 후 ${chosen.lines}줄 제거 · 빈 공간 ${chosen.holes}개 · 누적 높이 ${chosen.aggregate} · 굴곡 ${chosen.bump}.`;
}
function pause() {
  running = false;
  clearTimeout(timer);
  if (!ended)
    $("status").textContent = busy ? "● 현재 요청 완료 대기" : "● 일시정지";
  buttons();
}
function finish(reason) {
  ended = true;
  phase = reason;
  pause();
  $("status").textContent =
    reason === "gameover" ? "● GAME OVER" : "● 실험 완료";
  if (reason === "gameover")
    overlay("GAME OVER", "결과가 비교 목록에 저장되었습니다.");
  else overlay("실험 완료", "같은 시드에서 다른 규칙으로 다시 도전하세요.");
  saveExperiment();
  buttons();
}
function capture() {
  const rules = $("rules").value.trim();
  if ($("mode").value === "api" && rules.length < 5)
    throw Error("의사결정 규칙을 5자 이상 작성하세요.");
  if (
    $("mode").value === "api" &&
    !/^\S{10,512}$/.test($("apikey").value.trim())
  )
    throw Error("본인의 OpenAI API 키를 입력하세요.");
  snapshot = {
    name: $("rulename").value.trim() || "이름 없는 규칙",
    rules,
    mode: $("mode").value,
    weights: { ...weights },
    target: Math.max(1, Math.min(1000, Math.floor(+$("limit").value) || 50)),
  };
  $("limit").value = snapshot.target;
  runId = crypto.randomUUID();
  phase = "paused";
}
async function step() {
  if (ended || busy) return;
  const token = generation;
  try {
    if (!snapshot) capture();
  } catch (e) {
    $("connection").textContent = e.message;
    $("connection").className = "connection error";
    return;
  }
  if (!choices.length) {
    finish("gameover");
    return;
  }
  if (pieces >= snapshot.target) {
    finish("complete");
    return;
  }
  busy = true;
  buttons();
  const mode = snapshot.mode;
  $("status").textContent =
    mode === "api" ? "● 모델 판단 중" : "● 시연 판단 중";
  $("overlay").style.display = "none";
  const started = performance.now();
  let result, chosen;
  try {
    if (mode === "api") {
      requestController = new AbortController();
      const controller = requestController,
        timeout = setTimeout(() => controller.abort(), 17000);
      let response;
      try {
        response = await fetch("/api/decision", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + $("apikey").value.trim(),
          },
          body: JSON.stringify({ board, current, next, rules: snapshot.rules }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw Error("API 서버 응답을 해석하지 못했습니다.");
      }
      if (!response.ok) throw Error(data.error || "의사결정 요청 실패");
      result = data;
      chosen = choices.find(
        (c) => c.x === data.move?.x && c.rotation === data.move?.rotation,
      );
      if (!chosen)
        throw Error("모델이 고른 위치가 현재 보드에서 유효하지 않습니다.");
    } else {
      chosen = choices[0];
      result = {
        source: "local-demo",
        model: "weighted-heuristic",
        move: { x: chosen.x, rotation: chosen.rotation },
        confidence: null,
        apiMs: null,
      };
    }
    if (token !== generation) return;
    const elapsed = performance.now() - started,
      level = 1 + Math.floor(lines / 10);
    board = chosen.board;
    lines += chosen.lines;
    score += [0, 100, 300, 500, 800][chosen.lines] * level;
    pieces++;
    history.push({
      turn: pieces,
      piece: current,
      next,
      move: result.move,
      lines: chosen.lines,
      holes: chosen.holes,
      source: result.source,
      model: result.model,
      confidence: result.confidence,
      probabilities: result.probabilities ?? [],
      apiMs: result.apiMs,
      roundTripMs: elapsed,
    });
    showTable(result, chosen);
    showLatency(result, elapsed);
    current = next;
    next = drawPiece();
    phase = "paused";
    plan();
    $("status").textContent = running ? "● 실행 중" : "● 일시정지";
    if (!choices.length) finish("gameover");
    else if (pieces >= snapshot.target) finish("complete");
  } catch (e) {
    if (token !== generation) return;
    phase = "error";
    pause();
    $("status").textContent = "● 요청 오류";
    $("connection").textContent =
      e.name === "AbortError"
        ? "모델 요청 시간이 초과되었습니다. 다시 시도하세요."
        : e.message;
    $("connection").className = "connection error";
    overlay(
      "의사결정 요청 중단",
      "키와 연결 상태를 확인하고 계속하기를 누르세요.",
      true,
    );
  } finally {
    if (token === generation) {
      busy = false;
      requestController = null;
      buttons();
    }
  }
}
async function loop() {
  if (!running) return;
  const token = generation;
  await step();
  if (token !== generation) return;
  if (running && snapshot && !ended)
    timer = setTimeout(loop, 1200 / +$("speed").value);
  else if (running) {
    pause();
  }
}
$("play").onclick = () => {
  if (ended || (!running && busy)) return;
  if (running) pause();
  else {
    running = true;
    buttons();
    loop();
  }
};
$("step").onclick = async () => {
  pause();
  await step();
};
$("speed").oninput = () => {
  $("speedval").textContent = $("speed").value + "×";
};
function saveExperiment() {
  if (!snapshot || !pieces) return;
  const features = E.features(board),
    s = stats();
  const record = {
    id: runId,
    date: new Date().toISOString(),
    ...snapshot,
    seed,
    score,
    lines,
    pieces,
    height: features.height,
    holes: features.holes,
    ...s,
    phase,
  };
  experiments = [record, ...experiments.filter((r) => r.id !== runId)].slice(
    0,
    20,
  );
  try {
    localStorage.setItem(storageKey, JSON.stringify(experiments));
  } catch {
    $("status").textContent = "● 저장 공간 부족 · JSON 내보내기를 사용하세요.";
  }
  renderExperiments();
}
function renderExperiments() {
  const tbody = $("experiments");
  tbody.replaceChildren();
  $("savedcount").textContent = experiments.length;
  if (!experiments.length) {
    const tr = document.createElement("tr"),
      td = document.createElement("td");
    td.colSpan = 8;
    td.className = "empty";
    td.textContent = "완료한 실험이 여기에 쌓입니다. 첫 전략을 실행해 보세요.";
    tr.append(td);
    tbody.append(tr);
    return;
  }
  for (const r of experiments) {
    const tr = document.createElement("tr");
    const vals = [
      r.name + " · " + (r.mode === "api" ? "OpenAI" : "시연"),
      r.seed + " / " + r.target,
      r.score,
      r.lines,
      r.pieces,
      Math.round(r.mean) + " / " + Math.round(r.p95) + " ms",
      {
        complete: "완료",
        gameover: "게임 종료",
        error: "오류",
        paused: "중간 저장",
      }[r.phase] || "중간 저장",
    ];
    for (const val of vals) {
      const td = document.createElement("td");
      td.textContent = val;
      tr.append(td);
    }
    const td = document.createElement("td"),
      replay = document.createElement("button"),
      del = document.createElement("button");
    replay.textContent = "규칙 불러오기";
    replay.onclick = () => {
      reset(false);
      $("mode").value = r.mode;
      $("seedinput").value = r.seed;
      $("limit").value = r.target;
      $("rulename").value = r.name;
      $("rules").value = r.rules;
      $("preset").value = "custom";
      if (
        r.weights &&
        weightConfigs.every(
          ([k, , max]) =>
            Number.isFinite(r.weights[k]) &&
            r.weights[k] >= 0 &&
            r.weights[k] <= max,
        )
      )
        weights = { ...r.weights };
      syncWeights();
      ruleCount();
      reset(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    del.textContent = "×";
    del.className = "delete";
    del.setAttribute("aria-label", r.name + " 실험 삭제");
    del.onclick = () => {
      experiments = experiments.filter((x) => x.id !== r.id);
      try {
        localStorage.setItem(storageKey, JSON.stringify(experiments));
      } catch {}
      renderExperiments();
    };
    td.append(replay, del);
    tr.append(td);
    tbody.append(tr);
  }
}
function reset(save = true) {
  if (save && pieces) saveExperiment();
  generation++;
  requestController?.abort();
  pause();
  busy = false;
  ended = false;
  snapshot = null;
  phase = "ready";
  runId = null;
  board = E.empty();
  score = lines = pieces = 0;
  history = [];
  samples = [];
  seed = Math.max(
    1,
    Math.min(999999, Math.floor(+$("seedinput").value) || 202610),
  );
  $("seedinput").value = seed;
  drawPiece = E.bag(E.rng(seed));
  current = drawPiece();
  next = drawPiece();
  $("seedlabel").textContent = seed;
  $("status").textContent = "● 준비 완료";
  overlay("규칙을 준비하세요", "같은 시드, 다른 선택. 첫 실험을 시작하세요.");
  for (const id of ["value", "apims", "confidence", "average", "p95"])
    $(id).textContent = "—";
  $("chart").innerHTML =
    '<text x="8" y="40" fill="#778493" font-size="11">실행 후 응답 시간이 표시됩니다.</text>';
  $("turn").textContent = "TURN 000";
  $("reason").textContent =
    "첫 블록의 합법적 착지 후보를 모델에 보낼 준비가 되었습니다.";
  $("candidates").innerHTML =
    '<tr><td colspan="4" class="empty">선택 후 확률과 착지 정보가 표시됩니다.</td></tr>';
  plan();
  connection();
}
$("mode").onchange = () => reset();
$("reset").onclick = () => reset();
$("randomseed").onclick = () => {
  if (pieces) saveExperiment();
  $("seedinput").value = Math.floor(Math.random() * 999999) + 1;
  reset(false);
};
$("seedinput").onchange = () => reset(false);
$("save").onclick = saveExperiment;
$("export").onclick = () => {
  const payload = {
    experiment: snapshot,
    seed,
    score,
    lines,
    pieces,
    phase,
    stats: stats(),
    history,
    comparisons: experiments,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `decision-playground-${seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
setTemplate("balanced");
$("seedinput").value = 202610;
reset(false);
renderExperiments();
