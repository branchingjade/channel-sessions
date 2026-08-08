"""FastAPI 适配层：渠道会话管理插件后端。

Hermes 从 manifest.json 的 "api" 字段导入本文件，路由挂载在
/api/plugins/channel-sessions 下。业务逻辑在 channel_sessions.service。
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Optional

try:
    from fastapi import APIRouter, HTTPException
    from pydantic import BaseModel
except Exception:  # pragma: no cover - source-only environments
    class APIRouter:  # type: ignore[no-redef]
        def get(self, *_args, **_kwargs):
            return lambda function: function

        def post(self, *_args, **_kwargs):
            return lambda function: function

    class HTTPException(Exception):  # type: ignore[no-redef]
        def __init__(self, status_code: int, detail: str):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class BaseModel:  # type: ignore[no-redef]
        def __init__(self, **values):
            for key, value in values.items():
                setattr(self, key, value)


_DASHBOARD_DIR = Path(__file__).resolve().parent
_ADDED = str(_DASHBOARD_DIR) not in sys.path
if _ADDED:
    sys.path.insert(0, str(_DASHBOARD_DIR))
try:
    from channel_sessions.service import list_sessions, get_messages as service_get_messages, _mutate
finally:
    if _ADDED:
        sys.path.remove(str(_DASHBOARD_DIR))

router = APIRouter()


class SessionMutation(BaseModel):
    session_id: str = ""
    profile: str = "default"
    title: Optional[str] = None
    archived: Optional[bool] = None
    pinned: Optional[bool] = None


@router.get("/sessions")
def get_sessions(limit: int = 500) -> dict[str, Any]:
    """全量渠道会话列表（跨 profile），附会话人真名映射。"""
    try:
        return list_sessions(limit=min(max(limit, 1), 1000))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/messages")
def get_session_messages(session_id: str, profile: str = "default", limit: int = 200) -> dict[str, Any]:
    """读取指定会话的消息记录（只读）。"""
    try:
        return service_get_messages(profile, session_id, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/rename")
def rename_session(body: SessionMutation) -> dict[str, Any]:
    try:
        return _mutate(body.profile, "rename", body.session_id, title=body.title or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/archive")
def archive_session(body: SessionMutation) -> dict[str, Any]:
    try:
        return _mutate(body.profile, "archive", body.session_id, archived=bool(body.archived))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/pin")
def pin_session(body: SessionMutation) -> dict[str, Any]:
    try:
        return _mutate(body.profile, "pin", body.session_id, pinned=bool(body.pinned))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/delete")
def delete_session(body: SessionMutation) -> dict[str, Any]:
    try:
        return _mutate(body.profile, "delete", body.session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc))
