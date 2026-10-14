# Decision Playground

Bring your own OpenAI API key, write a Tetris strategy, and compare experiments with the same block sequence.

## Features

- OpenAI Decisions API (`gpt-6-luna`, `choice`) picks one of all legal hard-drop placements.
- Editable natural-language rules, three strategy templates, and a run-length limit.
- Fixed-seed 7-bag block generation for controlled comparisons.
- Actual browser/server round-trip times, confidence and choice probabilities.
- Browser-local experiment summaries, strategy reload, and JSON export.
- Explicit local heuristic demo with adjustable weights; it does not interpret natural-language rules or call OpenAI.

## Local run

Node.js 22 or newer. No package dependencies or installation step.

```bash
npm start
```

Open http://127.0.0.1:3000. Pick **로컬 시연** to try without an API key, or enter your own key and choose **OpenAI API**. The visitor's key is used per request; no application-owned key is needed.

1. Choose a template or edit the decision instructions.
2. Set the experiment name, seed and number of moves.
3. Start or step one move at a time. Pause waits for the current request to finish.
4. Completed runs save automatically; partial runs can be saved manually.
5. Reset with the same seed, change a rule, and rerun. Load previous rules from the comparison table.

Rules, mode and target length are frozen after the first request to keep each experiment consistent. Reset to change them. API calls can return different decisions even with identical instructions and seeds. Compare multiple runs; one score does not establish a universally optimal strategy.

## API key handling

- The key input is never written to localStorage, sessionStorage, experiment records or exports.
- The key is sent to the same-origin server in the Authorization header. The server passes it to OpenAI for that request; it has no credential database or request logging.
- Browser-local storage contains only experiment summaries and strategies, limited to 20 runs. The key input can be cleared explicitly; reloading the page clears it.
- A public deployment must use HTTPS. The hosting provider and OpenAI receive requests; this is a server-mediated BYOK app, not direct browser-to-OpenAI traffic.
- Each API move consumes the visitor's own API quota. ChatGPT Plus does not pay for API calls.
- If a call fails, the board stays unchanged and play stops. There is no automatic substitution of a demo result.
- No analytics, third-party scripts or remote fonts are included. The public host sets a same-origin Content Security Policy.

## Deploy on Vercel

The `public/` frontend and `api/decision.js` Node function are ready for Vercel. Import the repository, select **Other** as the framework, and keep `vercel.json` settings. No API-key environment variable is needed.

The function reuses the same decision logic as the local server. `includeFiles` keeps the browser-compatible Tetris engine in the function bundle. Future pushes can deploy through the Vercel GitHub integration.

## Checks

```bash
npm run check
npm test
```

Tests use a simulated OpenAI response to verify request schema, strategy instructions, legal action application, refusals, invalid choices, per-visitor credentials, input validation, the Node HTTP flow and the Vercel parsed-body adapter. Seeded game simulations verify line clearing and board dimensions. CI runs these checks on pushes and pull requests.

Real Decisions API calls and live latency require a visitor key and API access; they have not been verified in the development environment. 100ms is a chart reference, not a guaranteed service latency. API round-trip time includes network transport, not just model inference.

## Game scope

One game: Tetris. Each decision chooses rotation and column, followed by a hard drop. No hold, wall kicks or T-spin scoring. Only reachable top-down drops are candidates. Text below a decision explains derived board metrics, not private model reasoning.

Adding another game means adding its legal-action engine and a corresponding Decisions `choice` question; the current release focuses on strategy iteration in Tetris.

Official API guide: https://developers.openai.com/api/docs/guides/decisions
