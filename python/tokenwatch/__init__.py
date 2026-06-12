"""TokenWatch Python SDK — zero-dependency LLM cost & quality telemetry.

    from tokenwatch import wrap_openai, wrap_anthropic, init

    client = wrap_openai(OpenAI(), feature="chat")
    init(enforce_budget=True)  # optional: block calls when monthly budget is spent
"""
from __future__ import annotations

import atexit
import json
import os
import threading
import time
import urllib.error
import urllib.request

__all__ = ["init", "track", "flush", "wrap_openai", "wrap_anthropic", "BudgetExceededError"]
__version__ = "0.1.0"

# USD per 1M tokens, June 2026 — keep in sync with src/pricing.ts. Substring match.
_PRICING = {
    "claude-fable-5": (10.0, 50.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "gpt-5.5-pro": (30.0, 180.0),
    "gpt-5.5": (5.0, 30.0),
    "gemini-3.5-flash": (1.5, 9.0),
    "gemini-3.1-pro": (2.0, 12.0),
    "grok-4.3": (1.25, 2.5),
    "deepseek-v4": (0.3, 0.87),
    "glm-5": (0.6, 1.92),
    "kimi-k2.6": (0.6, 2.5),
}

_config = {
    "endpoint": os.environ.get("TOKENWATCH_URL", "http://localhost:4318"),
    "api_key": os.environ.get("TOKENWATCH_API_KEY"),
    "defaults": {},
    "enforce_budget": False,
}
_queue = []
_lock = threading.Lock()
_flusher_started = False
_guard_cache = {"state": None, "at": 0.0}


class BudgetExceededError(Exception):
    """Raised by wrapped clients when the monthly budget is spent and enforce_budget is on."""


def init(endpoint=None, api_key=None, defaults=None, enforce_budget=None):
    if endpoint is not None:
        _config["endpoint"] = endpoint.rstrip("/")
    if api_key is not None:
        _config["api_key"] = api_key
    if defaults is not None:
        _config["defaults"] = dict(defaults)
    if enforce_budget is not None:
        _config["enforce_budget"] = bool(enforce_budget)


def _cost_usd(model, input_tokens, output_tokens):
    m = (model or "").lower()
    for key in sorted(_PRICING, key=len, reverse=True):
        if key in m:
            inp, out = _PRICING[key]
            return (input_tokens * inp + output_tokens * out) / 1_000_000
    return 0.0


def track(model, input_tokens, output_tokens, provider=None, cost_usd=None, latency_ms=None,
          feature=None, customer_id=None, status="ok", error_type=None, ts=None):
    """Record one LLM call. Tokens in/out are required; cost is computed if omitted."""
    event = {
        "ts": ts if ts is not None else int(time.time() * 1000),
        "model": model or "unknown",
        "provider": provider,
        "inputTokens": int(input_tokens or 0),
        "outputTokens": int(output_tokens or 0),
        "costUsd": cost_usd if cost_usd is not None else _cost_usd(model, input_tokens or 0, output_tokens or 0),
        "latencyMs": latency_ms,
        "feature": feature if feature is not None else _config["defaults"].get("feature"),
        "customerId": customer_id if customer_id is not None else _config["defaults"].get("customer_id"),
        "status": status,
        "errorType": error_type,
    }
    with _lock:
        _queue.append(event)
        size = len(_queue)
    _ensure_flusher()
    if size >= 25:
        flush()


def flush():
    """Send all queued events now. Called automatically every 2s and at exit."""
    with _lock:
        if not _queue:
            return
        batch = list(_queue)
        del _queue[:]
    headers = {"Content-Type": "application/json"}
    if _config["api_key"]:
        headers["Authorization"] = "Bearer " + _config["api_key"]
    req = urllib.request.Request(
        _config["endpoint"] + "/v1/events",
        data=json.dumps({"events": batch}).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        with _lock:  # re-queue (bounded) so a transient outage doesn't lose data
            _queue[:0] = batch
            del _queue[1000:]


def _flush_loop():
    while True:
        time.sleep(2)
        try:
            flush()
        except Exception:
            pass


def _ensure_flusher():
    global _flusher_started
    if _flusher_started:
        return
    _flusher_started = True
    threading.Thread(target=_flush_loop, daemon=True).start()
    atexit.register(flush)


def _guard_state():
    now = time.time()
    if _guard_cache["state"] is not None and now - _guard_cache["at"] < 30:
        return _guard_cache["state"]
    try:
        with urllib.request.urlopen(_config["endpoint"] + "/v1/guard", timeout=3) as resp:
            state = json.loads(resp.read())
        _guard_cache["state"] = state
        _guard_cache["at"] = now
        return state
    except Exception:
        return None  # fail open: never break the user's app because the monitor is down


def _wrap_method(owner, attr, provider, tags):
    orig = getattr(owner, attr)

    def wrapped(*args, **kwargs):
        if kwargs.get("stream"):
            return orig(*args, **kwargs)  # v0.1: streaming passes through untracked
        if _config["enforce_budget"]:
            state = _guard_state()
            if state and state.get("blocked"):
                raise BudgetExceededError(
                    "TokenWatch: monthly budget exceeded ($%.2f of $%.2f). Call blocked."
                    % (state.get("spentMonthUsd", 0.0), state.get("budgetUsd") or 0.0)
                )
        t0 = time.time()
        try:
            result = orig(*args, **kwargs)
            usage = getattr(result, "usage", None)
            track(
                getattr(result, "model", None) or kwargs.get("model", "unknown"),
                getattr(usage, "input_tokens", None) or getattr(usage, "prompt_tokens", None) or 0,
                getattr(usage, "output_tokens", None) or getattr(usage, "completion_tokens", None) or 0,
                provider=provider,
                latency_ms=int((time.time() - t0) * 1000),
                **tags,
            )
            return result
        except BudgetExceededError:
            raise
        except Exception as err:
            track(
                kwargs.get("model", "unknown"), 0, 0,
                provider=provider,
                status="error",
                error_type=type(err).__name__,
                latency_ms=int((time.time() - t0) * 1000),
                **tags,
            )
            raise

    setattr(owner, attr, wrapped)


def wrap_openai(client, feature=None, customer_id=None):
    """Wrap an `openai` client in place: chat.completions.create (and responses.create) are tracked."""
    tags = {"feature": feature, "customer_id": customer_id}
    _wrap_method(client.chat.completions, "create", "openai", tags)
    if hasattr(client, "responses"):
        _wrap_method(client.responses, "create", "openai", tags)
    return client


def wrap_anthropic(client, feature=None, customer_id=None):
    """Wrap an `anthropic` client in place: messages.create is tracked."""
    _wrap_method(client.messages, "create", "anthropic", {"feature": feature, "customer_id": customer_id})
    return client
