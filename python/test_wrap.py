"""Smoke test for the Python SDK against a running TokenWatch server."""
import json
import time
import urllib.request
from types import SimpleNamespace

from tokenwatch import wrap_openai, wrap_anthropic, flush


class FakeOpenAI:
    def __init__(self):
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    @staticmethod
    def _create(**kwargs):
        return SimpleNamespace(model=kwargs["model"], usage=SimpleNamespace(prompt_tokens=222, completion_tokens=33))


class FakeAnthropic:
    def __init__(self, fail=False):
        self.messages = SimpleNamespace(create=self._fail if fail else self._create)

    @staticmethod
    def _create(**kwargs):
        return SimpleNamespace(model=kwargs["model"], usage=SimpleNamespace(input_tokens=444, output_tokens=55))

    @staticmethod
    def _fail(**kwargs):
        raise TimeoutError("provider timeout")


oai = wrap_openai(FakeOpenAI(), feature="py-wrap-test", customer_id="py-cust")
ant = wrap_anthropic(FakeAnthropic(), feature="py-wrap-test", customer_id="py-cust")
bad = wrap_anthropic(FakeAnthropic(fail=True), feature="py-wrap-test", customer_id="py-cust")

oai.chat.completions.create(model="gpt-5.5", messages=[])
ant.messages.create(model="claude-fable-5", max_tokens=10, messages=[])
try:
    bad.messages.create(model="claude-fable-5", max_tokens=10, messages=[])
except TimeoutError:
    pass

flush()
time.sleep(0.2)

with urllib.request.urlopen("http://localhost:4318/v1/stats?days=1", timeout=5) as r:
    stats = json.loads(r.read())

events = [e for e in stats["recent"] if e.get("feature") == "py-wrap-test"]
print(json.dumps([
    {"model": e["model"], "in": e["inputTokens"], "out": e["outputTokens"], "cost": e["costUsd"], "status": e["status"], "err": e["errorType"]}
    for e in events
], indent=1))
assert len(events) == 3, f"expected 3 events, got {len(events)}"
assert any(e["status"] == "error" and e["errorType"] == "TimeoutError" for e in events)
assert any(e["model"] == "gpt-5.5" and e["inputTokens"] == 222 for e in events)
assert any(e["model"] == "claude-fable-5" and e["outputTokens"] == 55 for e in events)
print("Python SDK test PASSED")
