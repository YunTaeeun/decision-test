import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { handleDecision, json } from "./endpoint.mjs";
const dir = fileURLToPath(new URL("./public/", import.meta.url));
export function createApp({ fetchImpl = fetch } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/decision")
        return await handleDecision(req, res, { fetchImpl });
      if (req.method !== "GET")
        return json(res, 405, { error: "지원하지 않는 요청입니다." });
      const path = resolve(
        dir,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!path.startsWith(dir))
        return json(res, 404, { error: "파일을 찾을 수 없습니다." });
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
      };
      try {
        const body = await readFile(path);
        res.writeHead(200, {
          "Content-Type": mime[extname(path)] ?? "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "no-cache",
        });
        res.end(body);
      } catch {
        json(res, 404, { error: "파일을 찾을 수 없습니다." });
      }
    } catch {
      if (!res.headersSent)
        json(res, 500, { error: "서버 요청을 처리하지 못했습니다." });
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  createApp().listen(Number(process.env.PORT) || 3000, "127.0.0.1", () =>
    console.log(
      "Decision Playground: http://127.0.0.1:" +
        (Number(process.env.PORT) || 3000),
    ),
  );
