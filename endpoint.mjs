import { decide, DecisionError } from "./decisions.mjs";
export function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}
export async function handleDecision(req, res, { fetchImpl = fetch } = {}) {
  if (req.method !== "POST")
    return json(res, 405, { error: "POST 요청만 허용됩니다." });
  const protocol = req.headers["x-forwarded-proto"] || "http";
  if (
    req.headers.origin &&
    req.headers.origin !== `${protocol}://${req.headers.host}`
  )
    return json(res, 403, { error: "동일한 사이트에서만 요청할 수 있습니다." });
  const auth = req.headers.authorization || "";
  if (!/^Bearer [^\s]{10,512}$/.test(auth))
    return json(res, 401, { error: "본인의 OpenAI API 키를 입력하세요." });
  let state;
  try {
    if (req.body !== undefined) {
      state = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (Buffer.byteLength(JSON.stringify(state)) > 16384)
        return json(res, 413, { error: "요청이 너무 큽니다." });
    } else {
      let size = 0,
        chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384)
          return json(res, 413, { error: "요청이 너무 큽니다." });
        chunks.push(chunk);
      }
      state = JSON.parse(Buffer.concat(chunks).toString());
    }
  } catch {
    return json(res, 400, { error: "JSON 요청이 유효하지 않습니다." });
  }
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 15000);
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const result = await decide(state, {
      apiKey: auth.slice(7),
      fetchImpl,
      signal: controller.signal,
    });
    json(res, 200, result);
  } catch (e) {
    if (!res.headersSent)
      json(res, e instanceof DecisionError ? e.status : 500, {
        error:
          e instanceof DecisionError
            ? e.message
            : "요청을 처리하지 못했습니다.",
      });
  } finally {
    clearTimeout(timeout);
  }
  // Key remains request-scoped. No credential storage or request logging.
}
