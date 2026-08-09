"""channel-sessions 插件后端测试套件。

运行方式（插件目录内）：
    python -m pytest tests/ -v

说明：
- 所有测试使用临时目录 + 内存/临时 SQLite 库，不触碰真实 state.db
- 需要 hermes-agent venv（hermes_state 可导入）
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

import pytest

_DASHBOARD_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_DASHBOARD_DIR))
sys.path.insert(0, str(_DASHBOARD_DIR / "channel_sessions"))

import service  # noqa: E402
from service import (  # noqa: E402
    NameResolver,
    _FEISHU_SOURCE,
    _SESSION_QUERY,
    _cache_path,
    _hermes_home,
    _lark_lookup_name,
    _mutate,
    _open_db_ro,
    _profile_dbs,
    _resolve_db,
    _rows_for_db,
    export_markdown,
    get_messages,
    list_sessions,
)


# ---------------------------------------------------------------- fixtures

@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    """构造一张最小可用的 sessions 表（字段与真实 state.db 对齐）。"""
    p = tmp_path / "state.db"
    conn = sqlite3.connect(p)
    conn.execute("""
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            source TEXT, user_id TEXT, title TEXT,
            started_at REAL, ended_at REAL, message_count INTEGER,
            chat_id TEXT, chat_type TEXT, thread_id TEXT,
            display_name TEXT, session_key TEXT,
            pinned INTEGER, archived INTEGER, profile_name TEXT,
            last_activity_at REAL, model TEXT,
            parent_session_id TEXT,
            system_prompt_hash TEXT,
            system_prompt TEXT
        )
    """)
    # SessionDB.get_session 依赖 system_prompts 表（LEFT JOIN hash）
    conn.execute("""
        CREATE TABLE system_prompts (
            hash TEXT PRIMARY KEY,
            prompt TEXT
        )
    """)
    rows = [
        ("s1", "feishu", "ou_aaa", "会话A", 100.0, 200.0, 5,
         "oc_1", "group", "", "飞书群A", "key1", 0, 0, "", 300.0, "gpt", None, None, None),
        ("s2", "feishu", "ou_bbb", "会话B", 100.0, None, 3,
         "", "dm", "", "", "key2", 1, 0, "", 290.0, "gpt", None, None, None),
        ("s3", "telegram", "123456", "会话C", 100.0, None, 2,
         "", "dm", "", "", "key3", 0, 1, "", 280.0, "gpt", None, None, None),
        ("s4", "desktop", "", "本地会话", 100.0, None, 1,
         "", "dm", "", "", "key4", 0, 0, "", 270.0, "gpt", None, None, None),
        # 压缩产生的子会话（parent 非空，应被列表过滤）
        ("s5", "feishu", "ou_aaa", "会话A-子", 100.0, None, 9,
         "", "dm", "", "", "key5", 0, 0, "", 400.0, "gpt", "s1", None, None),
    ]
    conn.executemany("""
        INSERT INTO sessions (id, source, user_id, title, started_at, ended_at,
                              message_count, chat_id, chat_type, thread_id,
                              display_name, session_key, pinned, archived,
                              profile_name, last_activity_at, model, parent_session_id,
                              system_prompt_hash, system_prompt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    # messages 表（供消息读取/分页测试）
    conn.execute("""
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT, role TEXT, content TEXT,
            timestamp REAL, tool_name TEXT, tool_calls TEXT,
            active INTEGER DEFAULT 1, compacted INTEGER DEFAULT 0
        )
    """)
    conn.executemany("""
        INSERT INTO messages (session_id, role, content, timestamp, active)
        VALUES (?, ?, ?, ?, ?)
    """, [
        ("s1", "user", "第一条消息", 100.0, 1),
        ("s1", "assistant", "回复一", 110.0, 1),
        ("s1", "user", "第二条消息", 120.0, 1),
        ("s1", "assistant", "回复二", 130.0, 1),
        ("s1", "tool", "工具输出", 140.0, 1),
    ])
    conn.commit()
    conn.close()
    return p


@pytest.fixture()
def resolver(tmp_path: Path) -> NameResolver:
    cache = tmp_path / "name_cache.json"
    return NameResolver(cache_path=cache)


# ---------------------------------------------------------------- 路径与查询

def test_hermes_home_returns_path():
    assert _hermes_home() is not None
    assert isinstance(_hermes_home(), Path)


def test_open_db_ro_rejects_write(db_path: Path):
    conn = _open_db_ro(db_path)
    try:
        # 只读模式：写操作应抛异常
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("DELETE FROM sessions")
    finally:
        conn.close()


def test_rows_for_db_filters_child_sessions(db_path: Path):
    rows = _rows_for_db(db_path, limit=100)
    ids = [r["id"] for r in rows]
    assert "s5" not in ids, "parent_session_id 非空的子会话不应出现在列表"
    assert "s1" in ids and "s2" in ids and "s3" in ids


def test_rows_for_db_respects_limit(db_path: Path):
    rows = _rows_for_db(db_path, limit=2)
    assert len(rows) == 2


def test_rows_for_db_missing_file_returns_empty(tmp_path: Path):
    rows = _rows_for_db(tmp_path / "nope.db", limit=10)
    assert rows == []


def test_profile_dbs_default_first(monkeypatch, tmp_path: Path, db_path: Path):
    """default 库应排在首位；多 profile 扫描应包含所有存在的库。"""
    fake_home = tmp_path / "hermes"
    fake_home.mkdir()
    # 模拟 default + 一个命名 profile
    (fake_home / "state.db").write_bytes(b"not-sqlite")
    prof = fake_home / "profiles" / "work"
    prof.mkdir(parents=True)
    (prof / "state.db").write_bytes(b"not-sqlite")
    monkeypatch.setattr(service, "_hermes_home", lambda: fake_home)
    dbs = _profile_dbs()
    assert dbs[0] == ("default", fake_home / "state.db")
    assert ("work", prof / "state.db") in dbs


# ---------------------------------------------------------------- NameResolver

def test_resolver_ignores_non_feishu_ids(resolver: NameResolver):
    assert resolver.resolve("123456") is None
    assert resolver.resolve("") is None
    assert resolver.resolve(None) is None  # type: ignore[arg-type]


def test_resolver_loads_cache_and_returns_fresh(resolver: NameResolver, tmp_path: Path):
    # 预置一条新鲜缓存
    cache = tmp_path / "name_cache.json"
    cache.write_text(json.dumps({"names": {"ou_aaa": {"name": "张三", "ts": time.time()}}}),
                     encoding="utf-8")
    r2 = NameResolver(cache_path=cache)
    assert r2.resolve("ou_aaa") == "张三"


def test_resolver_stale_entry_trigger_lookup(monkeypatch, resolver: NameResolver):
    # 过期缓存应触发反查（用 monkeypatch 替代真实 lark-cli 调用）
    resolver._cache["ou_stale"] = {"name": "旧名", "ts": 0}
    monkeypatch.setattr(service, "_lark_lookup_name", lambda oid: "新名")
    assert resolver.resolve("ou_stale") == "新名"
    assert resolver._cache["ou_stale"]["name"] == "新名"


def test_resolver_lookup_failure_cached_as_empty(monkeypatch, resolver: NameResolver):
    monkeypatch.setattr(service, "_lark_lookup_name", lambda oid: None)
    assert resolver.resolve("ou_fail") is None
    # 失败结果也缓存（空名），避免反复打 API
    assert resolver._cache["ou_fail"]["name"] == ""


def test_resolver_persists_to_disk(resolver: NameResolver, tmp_path: Path):
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(service, "_lark_lookup_name", lambda oid: "李四")
    resolver.resolve("ou_save")
    data = json.loads((tmp_path / "name_cache.json").read_text(encoding="utf-8"))
    assert data["names"]["ou_save"]["name"] == "李四"
    monkeypatch.undo()


def test_lark_lookup_name_rejects_bad_ids(monkeypatch):
    # 非 ou_ 前缀直接返回 None，不会触发子进程
    assert _lark_lookup_name("not-an-id") is None


# ---------------------------------------------------------------- list_sessions

def test_list_sessions_shape(db_path: Path, monkeypatch):
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    monkeypatch.setattr(service, "_lark_lookup_name", lambda oid: "真名")
    result = list_sessions(limit=100)
    assert set(result.keys()) == {"sessions", "names"}
    sessions = result["sessions"]
    assert len(sessions) == 4  # s5 子会话被过滤
    # 字段完整
    required = {"id", "source", "profile", "is_gateway", "user_name"}
    for s in sessions:
        assert required.issubset(s.keys())
    # profile 标注
    assert all(s["profile"] == "default" for s in sessions)
    # is_gateway 判定
    by_id = {s["id"]: s for s in sessions}
    assert by_id["s1"]["is_gateway"] is True
    assert by_id["s4"]["is_gateway"] is False  # desktop 不是渠道
    # 飞书反查名字注入
    assert by_id["s2"]["user_name"] == "真名"


def test_list_sessions_skips_bad_db(monkeypatch, tmp_path: Path, db_path: Path):
    """损坏的库不应拖垮整体列表。"""
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"garbage")
    monkeypatch.setattr(service, "_profile_dbs",
                        lambda: [("default", db_path), ("broken", bad)])
    result = list_sessions(limit=100)
    assert len(result["sessions"]) == 4  # 只来自 default
    assert result["sessions"][0]["profile"] == "default"


# ---------------------------------------------------------------- get_messages / _mutate

def test_get_messages_empty_session_id(db_path: Path, monkeypatch):
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    with pytest.raises(ValueError):
        get_messages("default", "  ")


def test_get_messages_unknown_profile(db_path: Path, monkeypatch):
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    with pytest.raises(ValueError):
        get_messages("ghost", "s1")


def test_get_messages_unknown_session_returns_empty(db_path: Path, monkeypatch):
    """未知 session_id 返回空列表 + has_more=False（不抛错）。"""
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    result = get_messages("default", "no_such_session")
    assert result["messages"] == []
    assert result["has_more"] is False


def test_get_messages_pagination(db_path: Path, monkeypatch):
    """分页读取：limit + offset 正确返回切片，has_more 判断准确。"""
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    # 第一页：limit=2 offset=0 → 前 2 条，还有更多
    page1 = get_messages("default", "s1", limit=2, offset=0)
    assert len(page1["messages"]) == 2
    assert page1["messages"][0]["content"] == "第一条消息"
    assert page1["has_more"] is True
    # 第二页：offset=2 → 中间 2 条，还有更多
    page2 = get_messages("default", "s1", limit=2, offset=2)
    assert len(page2["messages"]) == 2
    assert page2["messages"][0]["content"] == "第二条消息"
    assert page2["has_more"] is True
    # 第三页：offset=4 → 最后 1 条，没有更多
    page3 = get_messages("default", "s1", limit=2, offset=4)
    assert len(page3["messages"]) == 1
    assert page3["messages"][0]["role"] == "tool"
    assert page3["has_more"] is False
    # 越界 offset → 空列表，has_more=False
    page4 = get_messages("default", "s1", limit=2, offset=99)
    assert page4["messages"] == []
    assert page4["has_more"] is False


def test_mutate_unknown_op(db_path: Path, monkeypatch):
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    with pytest.raises(ValueError):
        _mutate("default", "explode", "s1")


def test_export_markdown_renders_sessions(db_path: Path, monkeypatch):
    """导出 Markdown：元数据头 + 分角色消息 + 时间戳。"""
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    result = export_markdown("default", "s1")
    md = result["markdown"]
    assert "# 会话A" in md
    assert "- Profile: default" in md
    assert "👤 User" in md
    assert "🤖 Assistant" in md
    assert "🛠" in md  # tool 消息
    assert "第一条消息" in md
    assert "工具输出" in md
    assert result["title"] == "会话A"


def test_export_markdown_unknown_session(db_path: Path, monkeypatch):
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    with pytest.raises(ValueError):
        export_markdown("default", "no_such_session")


def test_export_markdown_empty_session_id(db_path: Path, monkeypatch):
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    with pytest.raises(ValueError):
        export_markdown("default", "")


def test_mutate_empty_session_id(db_path: Path, monkeypatch):
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    with pytest.raises(ValueError):
        _mutate("default", "rename", "")


def test_resolve_db_unknown_profile(db_path: Path, monkeypatch):
    monkeypatch.setattr(service, "_profile_dbs", lambda: [("default", db_path)])
    with pytest.raises(ValueError):
        _resolve_db("nope")


def test_session_query_has_all_needed_columns():
    """确保查询列与前端期望字段一致，防止漏列。"""
    for col in ("id", "source", "user_id", "title", "started_at", "ended_at",
                "message_count", "chat_id", "chat_type", "thread_id",
                "display_name", "session_key", "pinned", "archived",
                "profile_name", "last_activity_at", "model"):
        assert col in _SESSION_QUERY


def test_cache_path_inside_plugin_dir():
    p = _cache_path()
    assert p.name == "name_cache.json"
    assert "channel-sessions" in str(p)
