# Order edits, readback, and response timing

The deployed branch `feature/lantern-waiter` at `9f08e37` could interpret “change the tea quantity to one” as an addition and “what is in my order?” as a menu question. Starting with tofu × 1 and iced tea × 2 ($11.00), the measured quantity request produced tea × 3 ($13.50) rather than tea × 1 ($8.50). Both phrases failed in two initial deployed conversations.

The contract had no absolute-quantity action or explicit order-readback action. `create_or_update_order` intentionally adds quantities, and the extraction prompt sent other questions to `menu_query`. Gemini's response schema also omitted the `replaces_sku` field used to target a dish swap.

## Fix behavior

- `set_quantity` sets the final count of one existing, unambiguous dish. It preserves stored modifiers and other basket lines; repeating the same count does not write another revision. Increases still validate availability and allergens. Multiple modifier variants require clarification.
- `readback` reads the saved basket and verified prices without writing or placing an order. No active order produces an empty-order clarification. Readback clears a previous placement confirmation, so it does not leave stale authorization behind.
- Complete, supported English readback and quantity-edit phrases are grounded before inference. Additions, menu questions, dish swaps, and combined requests continue through the normal model path. The shared provider prompt/schema exposes the new actions for other phrasing/languages; deterministic matching is not a general multilingual parser.
- Gemini's schema now permits `replaces_sku` and a clarification question. Same-dish replacement with a changed quantity is also accepted rather than treated as identical.

## Run regression tests

Use the project's Python environment with `requirements.txt` installed, from the repository root:

```powershell
python -m unittest discover -s tests -p test_order_edits.py -v
python -m unittest discover -s tests -v
```

The regression tests cover the original phrases, saved modifiers, no-op edits, ambiguous variants, missing targets, quantity bounds, sold-out increases/decreases, post-placement revision behavior, provider contracts, and WebSocket reconnect/readback. The WebSocket test uses scripted extraction and fixture PCM, not live Gemini or Cartesia.

## Reusable benchmark script

Run the deterministic replay without provider requests:

```powershell
python -m eval.benchmarks.restaurant.order_edits --repeat 3
```

The replay intentionally returns the old wrong intents for the original phrases. It verifies that the session's deterministic grounding prevents those mistakes. Offline response times measure local scripted execution, not cloud model or voice latency.

Run against the deployed application or a patched local backend:

```powershell
python -m eval.benchmarks.restaurant.order_edits --server-url https://lantern-zqen.onrender.com --table T10 --repeat 2
python -m eval.benchmarks.restaurant.order_edits --server-url http://127.0.0.1:8000 --table T10 --repeat 2
```

The remote mode uses the server's configured providers; it needs no provider keys on the benchmarking computer. Use a free provisioned table. It checks the fixture SKUs, prices, and availability before starting. If the menu changes, update `STEPS` and its prerequisite check before comparing results.

Each repetition checks ten turns: initial addition, absolute quantity, order question, explicit repeat, another drink, removing one drink, dish swap, unknown dish, cancellation request, and cancellation confirmation. It reconnects midway using the existing order ID and checks session continuity. The saved REST basket is checked after every turn, so a plausible spoken response alone cannot pass the suite.

It never requests placement. Unexpected placement stops the run and is reported. Drafts it created are cancelled and verified in cleanup; cancelled records/revision history remain in the server database. Remote runs incur provider requests. Do not run this workload on a table serving a real guest.

The output directory is unique for every run:

```text
reports/restaurant/order-edits/<UTC-run-id>/
  manifest.json
  results.json
  summary.md
  orders.sqlite3  (offline replay only)
```

`--output-root PATH` changes the report root, and `--timeout 45` controls the absolute connection/turn deadlines. Exit code 0 requires every expected step, resume check, and cleanup check to pass; 2 records a failed or incomplete suite. Failed turns remain in `results.json`; they are not silently retried or counted as successes. A turn error ends that conversation before cleanup so late responses cannot be assigned to another test input.

Remote timing records:

- `response_ms`: final-transcript submission to response text arrival.
- `first_audio_ms`: submission to first generated PCM received by the client.
- `complete_ms`: submission to the server's `turn_complete` event.
- `server_pipeline_ms`: the server-reported workflow time.

These measurements exclude microphone capture, ASR endpointing, and device speaker onset. Completion is not the end of audio playback. The JSON includes attempted/pass counts, individual failures, median, nearest-rank p95, maximum, and sample count. Small-sample percentiles should be read alongside the maxima and errors. No load capacity or real-user Core Web Vitals score is inferred.

## Validation limits

The fixed implementation passed 68 repository tests, including 17 new regressions, and all 30 steps in three offline replay repetitions. Python compilation and frontend typecheck/build also passed. [Compact validation evidence](order-edit-validation.json) preserves the deployed failures and these checks for reviewers.

A new completed deployed run reproduced the quantity/readback problems: all ten turns completed, while only two passed the exact gates. Later basket gates inherit the quantity mistake, so this does not mean eight independent defects. Its median response-text, first-audio, and completion arrivals were 1.337 s, 1.526 s, and 3.112 s respectively. Resume and cancellation cleanup succeeded.

A separate fresh deployed run emitted an empty server error after approximately 30 seconds on the initial addition, despite `/ready` reporting true; that failure was preserved separately from correctness results. The order-edit patch does not diagnose or fix that provider timeout. The deployment must be updated and re-benchmarked before claiming the fixes work on the public site. Local Gemini/Cartesia credentials were unavailable during this validation, so mocked provider-contract tests are labelled accordingly.
