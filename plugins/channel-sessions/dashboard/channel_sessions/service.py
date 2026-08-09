"""渠道会话管理核心业务逻辑。

职责：
1. 只读扫描各 profile 的 state.db，返回渠道会话的富字段列表
   （含 chat_id/chat_type/thread_id/session_key/user_id/display_name 等列表接口不带的信息）
2. 飞书发送者 open_id -> 真名反查（lark-cli bot 身份 + 本地 JSON 缓存，线程池并发）
3. 管理操作代理：重命名/归档/置顶/删除（复用 hermes_state.SessionDB）

参考：skill-manager 插件结构、hermes_cli/web_routers/profiles.py（read_only 读法）。
"""

from __future__ import annotations

import json
import logging
import shutil
import sqlite3
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

PLUGIN_ID = "channel-sessions"
_NAME_CACHE_FILE = "name_cache.json"
_NAME_CACHE_TTL_SECONDS = 7 * 24 * 3600  # 一周内不重复反查
_FEISHU_SOURCE = "feishu"
_LOOKUP_MAX_WORKERS = 4  # lark-cli 子进程并发上限（兼顾 5 QPS 限流与响应延迟）
_SESSION_QUERY = """
SELECT id, source, user_id, title, started_at, ended_at, message_count,
       chat_id, chat_type, thread_id, display_name, session_key,
       pinned, archived, profile_name, last_activity_at, model
FROM sessions
WHERE (parent_session_id IS NULL OR parent_session_id = '')
ORDER BY COALESCE(last_activity_at, started_at, 0) DESC
LIMIT ?
"""


# ---------------------------------------------------------------- 路径

def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        home = Path.home()
        win_candidate = home / "AppData/Local/hermes"
        if win_candidate.is_dir():
            return win_candidate
        return home / ".hermes"


def _cache_path() -> Path:
    return Path(__file__).resolve().parent / "data" / _NAME_CACHE_FILE


def _profile_dbs() -> List[Tuple[str, Path]]:
    """返回 [(profile_name, state.db 路径)]，default 在最前。"""
    home = _hermes_home()
    result: List[Tuple[str, Path]] = []
    default_db = home / "state.db"
    if default_db.exists():
        result.append(("default", default_db))
    profiles_dir = home / "profiles"
    if profiles_dir.is_dir():
        for p in sorted(profiles_dir.iterdir()):
            db = p / "state.db"
            if p.is_dir() and db.exists():
                result.append((p.name, db))
    return result


def _open_db_ro(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


# ---------------------------------------------------------------- 真名反查

def _find_lark_cli() -> Optional[str]:
    for name in ("lark-cli.cmd", "lark-cli"):
        exe = shutil.which(name)
        if exe:
            return exe
    node_dir = _hermes_home() / "node"
    for name in ("lark-cli.cmd", "lark-cli"):
        cand = node_dir / name
        if cand.exists():
            return str(cand)
    return None


def _lark_lookup_name(open_id: str) -> Optional[str]:
    """bot 身份反查单个 open_id 的真名。失败静默返回 None（记 debug 日志）。"""
    exe = _find_lark_cli()
    if not exe or not open_id.startswith("ou_"):
        return None
    try:
        proc = subprocess.run(
            [exe, "contact", "+get-user", "--user-id", open_id, "--as", "bot"],
            capture_output=True, text=True, timeout=20,
            encoding="utf-8", errors="replace",
        )
        if proc.returncode != 0:
            logger.debug("lark-cli 反查失败 rc=%s open_id=%s stderr=%s",
                         proc.returncode, open_id, proc.stderr[:200])
            return None
        payload = json.loads(proc.stdout)
        name = (payload.get("data") or {}).get("user") or {}
        return name.get("name") or None
    except json.JSONDecodeError:
        logger.debug("lark-cli 反查输出非 JSON open_id=%s", open_id)
        return None
    except Exception as exc:
        logger.debug("lark-cli 反查异常 open_id=%s: %s", open_id, exc)
        return None


class NameResolver:
    """open_id -> 真名。缓存落盘，避免频繁调飞书 API（5 QPS 限流）。

    线程安全：_lock 保护缓存读写与落盘；并发反查由调用方线程池负责，
    这里只做单次查询 + 缓存更新。
    """

    def __init__(self, cache_path: Optional[Path] = None) -> None:
        self._lock = threading.Lock()
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._cache_path = Path(cache_path) if cache_path else _cache_path()
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self._cache_path.read_text(encoding="utf-8"))
            self._cache = data.get("names", {})
        except FileNotFoundError:
            self._cache = {}
        except Exception as exc:
            logger.warning("真名缓存读取失败 %s: %s", self._cache_path, exc)
            self._cache = {}

    def _save(self) -> None:
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._cache_path.write_text(
                json.dumps({"names": self._cache}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            logger.warning("真名缓存写入失败 %s: %s", self._cache_path, exc)

    def _fresh(self, entry: Dict[str, Any]) -> bool:
        return time.time() - entry.get("ts", 0) < _NAME_CACHE_TTL_SECONDS

    def resolve(self, open_id: str) -> Optional[str]:
        """查缓存（命中且新鲜直接返回），否则走 lark-cli 反查并落缓存。"""
        if not open_id or not open_id.startswith("ou_"):
            return None
        with self._lock:
            entry = self._cache.get(open_id)
            if entry and self._fresh(entry) and entry.get("name"):
                return entry["name"]
        name = _lark_lookup_name(open_id)
        with self._lock:
            self._cache[open_id] = {"name": name or "", "ts": time.time()}
            self._save()
        return name


# ---------------------------------------------------------------- 会话列表

def _rows_for_db(db_path: Path, limit: int) -> List[Dict[str, Any]]:
    try:
        conn = _open_db_ro(db_path)
    except Exception as exc:
        logger.warning("打开会话库失败 %s: %s", db_path, exc)
        return []
    try:
        rows = conn.execute(_SESSION_QUERY, (limit,)).fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning("读取会话库失败 %s: %s", db_path, exc)
        return []
    finally:
        conn.close()


def list_sessions(limit: int = 500) -> Dict[str, Any]:
    """聚合所有 profile 的渠道会话，附上会话人真名。

    真名反查用线程池并发（lark-cli 子进程是 I/O 密集，串行会拖慢响应）。
    """
    resolver = NameResolver()
    sessions: List[Dict[str, Any]] = []
    for profile_name, db_path in _profile_dbs():
        rows = _rows_for_db(db_path, limit)
        for s in rows:
            s["profile"] = profile_name
            s["is_gateway"] = bool(s.get("source")) and s["source"] not in ("cli", "tui", "desktop")
            sessions.append(s)

    # 真名反查：只对飞书来源且缺名字的私聊/未知会话反查（线程池并发）
    lookup_ids = sorted({
        str(s["user_id"])
        for s in sessions
        if s.get("source") == _FEISHU_SOURCE
        and s.get("user_id")
        and str(s.get("user_id", "")).startswith("ou_")
    })
    names: Dict[str, str] = {}
    if lookup_ids:
        with ThreadPoolExecutor(max_workers=_LOOKUP_MAX_WORKERS) as pool:
            future_map = {pool.submit(resolver.resolve, oid): oid for oid in lookup_ids}
            for future in as_completed(future_map):
                oid = future_map[future]
                try:
                    name = future.result()
                except Exception as exc:  # 单个反查失败不影响整体
                    logger.debug("反查线程异常 open_id=%s: %s", oid, exc)
                    continue
                if name:
                    names[oid] = name

    for s in sessions:
        uid = str(s.get("user_id") or "")
        s["user_name"] = names.get(uid) or ""
        if not s["user_name"] and s.get("source") == _FEISHU_SOURCE:
            # 群聊 display_name 是群名；私聊回退 chat_id 时尝试用 open_id 尾号标注
            s["user_name"] = ""
    return {"sessions": sessions, "names": names}


# ---------------------------------------------------------------- 管理操作

def _resolve_db(profile: str) -> Tuple[str, Path]:
    for name, db_path in _profile_dbs():
        if name == profile:
            return name, db_path
    raise ValueError(f"未知 profile: {profile}")


def get_messages(profile: str, session_id: str, limit: int = 200, offset: int = 0) -> Dict[str, Any]:
    """只读读取会话消息（复用 SessionDB.get_messages，保持与官方 API 一致）。

    limit/offset 用于分页：offset=0 取最新 limit 条；offset=当前已加载数
    继续取更早的消息（插入序分页）。
    """
    if not session_id or not session_id.strip():
        raise ValueError("session_id 不能为空")
    from hermes_state import SessionDB

    _, db_path = _resolve_db(profile)
    db = SessionDB(db_path=db_path, read_only=True)
    try:
        sid = db.resolve_session_id(session_id)
        if not sid:
            return {"session_id": session_id, "messages": [], "has_more": False}
        sid = db.resolve_resume_session_id(sid)
        limit = min(max(limit, 1), 500)
        offset = max(offset, 0)
        messages = db.get_messages(sid, limit=limit, offset=offset)
        # 再多取一条判断是否还有更早消息（has_more）
        probe = db.get_messages(sid, limit=1, offset=offset + limit)
        # 瘦身：去掉大字段，保留前端渲染所需
        slim = []
        for m in messages:
            slim.append({
                "id": m.get("id"),
                "role": m.get("role"),
                "content": m.get("content"),
                "timestamp": m.get("timestamp"),
                "tool_name": m.get("tool_name"),
                "tool_calls": m.get("tool_calls"),
                "active": m.get("active", 1),
                "compacted": bool(m.get("compacted")),
            })
        return {"session_id": sid, "messages": slim, "has_more": bool(probe)}
    finally:
        db.close()


# ---------------------------------------------------------------- 导出

def export_markdown(profile: str, session_id: str) -> Dict[str, Any]:
    """导出会话为 Markdown：元数据头 + 分角色消息（纯只读，无外部依赖）。"""
    if not session_id or not session_id.strip():
        raise ValueError("session_id 不能为空")
    from hermes_state import SessionDB

    _, db_path = _resolve_db(profile)
    db = SessionDB(db_path=db_path, read_only=True)
    try:
        sid = db.resolve_session_id(session_id)
        if not sid:
            raise ValueError(f"会话不存在: {session_id}")
        sid = db.resolve_resume_session_id(sid)
        messages = db.get_messages(sid, limit=500)
        session = db.get_session(sid) or {}
        lines: List[str] = []
        lines.append(f"# {session.get('title') or session_id}")
        lines.append("")
        lines.append(f"- Profile: {profile}")
        lines.append(f"- Source: {session.get('source') or 'unknown'}")
        if session.get("model"):
            lines.append(f"- Model: {session['model']}")
        if session.get("started_at"):
            started = time.strftime("%Y-%m-%d %H:%M", time.localtime(float(session["started_at"])))
            lines.append(f"- Started: {started}")
        if session.get("message_count"):
            lines.append(f"- Messages: {session['message_count']}")
        lines.append("")
        lines.append("---")
        lines.append("")
        for m in messages:
            role = m.get("role") or "unknown"
            content = str(m.get("content") or "")
            if role == "session_meta":
                continue
            ts = ""
            if m.get("timestamp"):
                ts = time.strftime("%Y-%m-%d %H:%M", time.localtime(float(m["timestamp"])))
            if role == "tool":
                tool = m.get("tool_name") or "tool"
                lines.append(f"### 🛠 {tool} {f'({ts})' if ts else ''}")
            elif role == "user":
                lines.append(f"### 👤 User {f'({ts})' if ts else ''}")
            else:
                lines.append(f"### 🤖 Assistant {f'({ts})' if ts else ''}")
            lines.append("")
            lines.append(content.strip())
            lines.append("")
        return {
            "session_id": sid,
            "title": session.get("title") or session_id,
            "markdown": "\n".join(lines),
        }
    finally:
        db.close()


def _mutate(profile: str, op: str, session_id: str, **kwargs) -> Dict[str, Any]:
    """管理操作代理。所有参数经 API 层校验，这里再兜底防御。

    支持 op: rename / archive / pin / delete。
    """
    if not session_id or not session_id.strip():
        raise ValueError("session_id 不能为空")
    if op not in ("rename", "archive", "pin", "delete"):
        raise ValueError(f"未知操作: {op}")
    from hermes_state import SessionDB

    _, db_path = _resolve_db(profile)
    db = SessionDB(db_path=db_path)
    try:
        if op == "rename":
            title = kwargs.get("title") or ""
            db.set_session_title(session_id, str(title))
        elif op == "archive":
            db.set_session_archived(session_id, bool(kwargs.get("archived")))
        elif op == "pin":
            db.set_session_pinned(session_id, bool(kwargs.get("pinned")))
        elif op == "delete":
            db.delete_session(session_id)
    except ValueError:
        raise
    except Exception as exc:
        logger.warning("会话操作失败 op=%s session=%s: %s", op, session_id, exc)
        raise
    finally:
        db.close()
    logger.info("会话操作成功 op=%s session=%s", op, session_id)
    return {"ok": True, "session_id": session_id, "op": op}


# ---------------------------------------------------------------- 按对象批量删除

def _object_key(s: Dict[str, Any]) -> str:
    """与前端 objectKey() 对齐的会话对象键（local / group: / topic: / person:）。"""
    source = s.get("source") or ""
    if source in ("desktop", "cli", "tui"):
        return "local"
    chat_type = s.get("chat_type") or ""
    chat_id = str(s.get("chat_id") or "")
    user_id = str(s.get("user_id") or "")
    thread_id = str(s.get("thread_id") or "")
    if source == "feishu":
        return f"group:{chat_id or 'g'}" if chat_type == "group" else f"person:{user_id or 'u'}"
    if chat_type in ("group", "chat"):
        return f"group:{chat_id or 'g'}"
    if chat_type in ("topic", "thread"):
        return f"topic:{chat_id or 'g'}:{thread_id or 't'}"
    return f"person:{user_id or 'u'}"


def delete_by_object(object_key: str) -> Dict[str, Any]:
    """按对象键删除该对象（人/群/话题/本地）的全部会话。"""
    if not object_key or not object_key.strip():
        raise ValueError("object_key 不能为空")
    deleted: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    for profile_name, db_path in _profile_dbs():
        rows = _rows_for_db(db_path, limit=100000)
        for s in rows:
            if _object_key(s) != object_key:
                continue
            sid = str(s.get("id") or "")
            if not sid:
                continue
            try:
                _mutate(profile_name, "delete", sid)
                deleted.append({"session_id": sid, "title": (s.get("title") or "")[:40]})
            except Exception as exc:
                failed.append({"session_id": sid, "error": str(exc)})
    logger.info("按对象删除完成 object_key=%s deleted=%d failed=%d", object_key, len(deleted), len(failed))
    return {
        "ok": True,
        "object_key": object_key,
        "deleted_count": len(deleted),
        "failed_count": len(failed),
        "deleted": deleted[:50],
        "failed": failed[:20],
    }
