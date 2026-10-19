# homeops

A local home-automation event bus. Post events from any source (CLI, voice, sensors, agents), stream them in real time over SSE, and track the current home mode.

## Quickstart

```bash
pip install -e ".[dev]"
uvicorn homeops.bus:app --reload
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events` | Publish an event |
| `GET` | `/stream` | SSE stream of all new events |
| `GET` | `/state` | Current mode + last 50 events |
| `GET` | `/health` | Health check |

## Event types

`cli.command`, `voice.utterance`, `sensor.doorbell`, `sensor.motion`, `cv.detection`, `agent.thought`, `agent.action`, `home.mode`, `voice.say`

Posting a `home.mode` event updates the current mode (`normal` or `security`).

## Running tests

```bash
pytest
```
