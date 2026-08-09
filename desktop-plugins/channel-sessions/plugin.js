/**
 * 渠道会话管理 v1.4.2 — 三栏布局：左导航 | 会话列表 | 消息详情。
 * v1.4.2: 修复 UI 破损（不存在的 --ui-fill-*/字号类全部替换为编译产物存在的类）+ 分类操作按钮常显。
 * v1.4.1: 语言切换（auto 跟随设备 + 手动中英）+ 自定义分类 CRUD + 收藏 + 导出 Markdown。
 * v1.4.0: 会话列表自动刷新（15s）+ 后端日志/并发反查加固 + 消息分页（开源发布版）。
 * v1.3: 点击会话行直接在插件内查看消息内容（user/assistant/tool 分角色渲染），
 *       详情头部可打开完整会话/重命名/置顶/归档/删除。
 * 多条件组合筛选（平台 × 会话人 × 状态 × 类型 × 分类 × 搜索）+ UI 状态持久化。
 * 纯 ESM，无构建步骤。用 jsx()/jsxs() 而非 JSX 语法。
 */
import {
  Badge, Button, Codicon, ConfirmDialog, Dialog, DialogContent,
  DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger, EmptyState, ErrorState, GlyphSpinner, Input,
  PALETTE_AREA, ROUTES_AREA, ScrollArea, SearchField, SegmentedControl,
  SIDEBAR_NAV_AREA, useI18n, useMutation, useQuery, useQueryClient, host
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useState } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

const ID = 'channel-sessions'
const ROUTE = '/channel-sessions'
const QUERY_KEY = [ID, 'sessions']
const REFRESH_INTERVAL_MS = 15000
const MESSAGES_REFETCH_MS = 30000
const UI_STORAGE_KEY = 'ui'
const LANG_STORAGE_KEY = 'lang'
const CATEGORIES_KEY = 'categories'
const SESSION_CATS_KEY = 'sessionCats'
const FAVORITES_KEY = 'favorites'

const DEFAULT_FILTERS = { platform: 'all', person: 'all', status: 'all', type: 'all', query: '', category: 'all' }

// ---------------------------------------------------------------- i18n 字典

const MESSAGES = {
  en: {
    'title': 'Channel Sessions',
    'count': n => `${n} sessions`,
    'refresh': 'Refresh',
    'search.placeholder': 'Search sessions…',
    'filter.platform': 'Platform',
    'filter.person': 'People',
    'filter.status': 'Status',
    'filter.type': 'Type',
    'filter.category': 'My categories',
    'filter.category.empty': 'No categories yet',
    'filter.category.empty.desc': 'Create one to group sessions.',
    'filter.category.new': 'New category',
    'filter.category.rename': 'Rename',
    'filter.category.delete': 'Delete category',
    'filter.category.name': 'Category name',
    'filter.category.name.placeholder': 'e.g. Work, Family…',
    'filter.category.assign': 'Category…',
    'filter.category.none': 'No category',
    'filter.category.delete.title': 'Delete category?',
    'filter.category.delete.desc': name => `"${name}" will be removed. Sessions keep their data.`,
    'lang.auto': 'Auto',
    'lang.zh': '中文',
    'lang.en': 'English',
    'lang.label': 'Language',
    'filter.all': 'All',
    'filter.pinned': 'Pinned',
    'filter.archived': 'Archived',
    'filter.favorites': 'Favorites',
    'action.favorite': 'Favorite',
    'action.unfavorite': 'Unfavorite',
    'action.export': 'Export',
    'action.export.title': 'Export as Markdown',
    'action.export.done': 'Exported',
    'action.export.failed': 'Export failed',
    'filter.groups': 'Groups / Channels',
    'filter.local': 'Local sessions',
    'filter.clear': 'Clear',
    'filter.active': parts => parts,
    'filter.searching': q => `Search "${q}"`,
    'list.all': 'All sessions',
    'list.empty': 'No matching sessions',
    'list.empty.desc': 'Adjust filters on the left.',
    'list.loading.failed': 'Failed to load',
    'list.loading.failed.desc': 'Make sure the plugin is enabled and restart the desktop app.',
    'detail.select': 'Select a session to view content',
    'detail.select.desc': 'Chat history appears here after selection.',
    'detail.back': 'Back to list',
    'detail.messages': n => `${n} messages`,
    'detail.open.full': 'Open full',
    'detail.open.full.title': 'Open in the full chat page',
    'detail.messages.empty': 'No messages',
    'detail.messages.empty.desc': 'This session has no messages to display.',
    'msg.user': 'Me',
    'msg.ai': 'AI',
    'msg.tool': 'Tool call',
    'msg.expand': n => `Expand (${n} chars)`,
    'msg.collapse': 'Collapse',
    'msg.empty.user': '(empty message)',
    'msg.empty.assistant': '(no reply content)',
    'msg.compacted': '(compressed)',
    'msg.load_more': 'Load earlier messages',
    'msg.loading': 'Loading…',
    'msg.all_loaded': 'All messages loaded',
    'time.just_now': 'just now',
    'time.minutes_ago': n => `${n}m ago`,
    'time.hours_ago': n => `${n}h ago`,
    'time.yesterday': 'yesterday',
    'time.days_ago': n => `${n}d ago`,
    'type.dm': 'DM',
    'type.group': 'Group',
    'type.topic': 'Topic',
    'type.other': 'Other',
    'person.unknown': '(unknown person)',
    'person.feishu_user': 'Feishu user',
    'person.user': id => `User ${id}`,
    'group.fallback': p => `${p} group`,
    'topic.fallback': p => `${p} topic`,
    'local.label': 'Local session',
    'untitled': '(untitled)',
    'action.open': 'Open session',
    'action.rename': 'Rename',
    'action.pin': 'Pin',
    'action.unpin': 'Unpin',
    'action.archive': 'Archive',
    'action.unarchive': 'Unarchive',
    'action.delete': 'Delete session',
    'rename.title': 'Rename session',
    'rename.desc': 'The new title overrides the AI-generated one.',
    'rename.cancel': 'Cancel',
    'rename.save': 'Save',
    'delete.title': 'Delete session?',
    'delete.desc': t => `"${t}" will be permanently deleted. This cannot be undone.`,
    'delete.confirm': 'Delete',
    'profile.badge': p => p,
  },
  zh: {
    'title': '渠道会话',
    'count': n => `${n} 个`,
    'refresh': '刷新',
    'search.placeholder': '搜索会话…',
    'filter.platform': '平台',
    'filter.person': '会话人',
    'filter.status': '状态',
    'filter.type': '类型',
    'filter.category': '我的分类',
    'filter.category.empty': '还没有分类',
    'filter.category.empty.desc': '创建一个来给会话分组。',
    'filter.category.new': '新建分类',
    'filter.category.rename': '重命名',
    'filter.category.delete': '删除分类',
    'filter.category.name': '分类名称',
    'filter.category.name.placeholder': '如：工作、家人…',
    'filter.category.assign': '分类…',
    'filter.category.none': '无分类',
    'filter.category.delete.title': '删除分类？',
    'filter.category.delete.desc': name => `「${name}」将被删除，会话数据不受影响。`,
    'lang.auto': '自动',
    'lang.zh': '中文',
    'lang.en': 'English',
    'lang.label': '语言',
    'filter.all': '全部',
    'filter.pinned': '已置顶',
    'filter.archived': '已归档',
    'filter.favorites': '已收藏',
    'action.favorite': '收藏',
    'action.unfavorite': '取消收藏',
    'action.export': '导出',
    'action.export.title': '导出为 Markdown',
    'action.export.done': '已导出',
    'action.export.failed': '导出失败',
    'filter.groups': '群聊 / 频道',
    'filter.local': '本地会话',
    'filter.clear': '清除',
    'filter.active': parts => parts,
    'filter.searching': q => `搜索「${q}」`,
    'list.all': '全部会话',
    'list.empty': '没有匹配的会话',
    'list.empty.desc': '调整左侧筛选条件。',
    'list.loading.failed': '加载失败',
    'list.loading.failed.desc': '请确认插件已启用并重启桌面应用。',
    'detail.select': '点击左侧会话查看内容',
    'detail.select.desc': '选中会话后，聊天记录会直接显示在这里。',
    'detail.back': '返回列表',
    'detail.messages': n => `${n} 条消息`,
    'detail.open.full': '完整打开',
    'detail.open.full.title': '在完整聊天页打开',
    'detail.messages.empty': '没有消息记录',
    'detail.messages.empty.desc': '该会话还没有可显示的消息。',
    'msg.user': '我',
    'msg.ai': 'AI',
    'msg.tool': '工具调用',
    'msg.expand': n => `展开全文（共${n}字）`,
    'msg.collapse': '收起',
    'msg.empty.user': '（空消息）',
    'msg.empty.assistant': '（无回复内容）',
    'msg.compacted': '（此段已被压缩）',
    'msg.load_more': '加载更早的消息',
    'msg.loading': '加载中…',
    'msg.all_loaded': '已加载全部消息',
    'time.just_now': '刚刚',
    'time.minutes_ago': n => `${n}分钟前`,
    'time.hours_ago': n => `${n}小时前`,
    'time.yesterday': '昨天',
    'time.days_ago': n => `${n}天前`,
    'type.dm': '私聊',
    'type.group': '群聊',
    'type.topic': '话题',
    'type.other': '其他',
    'person.unknown': '(未知会话人)',
    'person.feishu_user': '飞书用户',
    'person.user': id => `用户 ${id}`,
    'group.fallback': p => `${p}群`,
    'topic.fallback': p => `${p}话题`,
    'local.label': '本地会话',
    'untitled': '（无标题）',
    'action.open': '打开会话',
    'action.rename': '重命名',
    'action.pin': '置顶',
    'action.unpin': '取消置顶',
    'action.archive': '归档',
    'action.unarchive': '取消归档',
    'action.delete': '删除会话',
    'rename.title': '重命名会话',
    'rename.desc': '新标题会覆盖 AI 自动生成的标题。',
    'rename.cancel': '取消',
    'rename.save': '保存',
    'delete.title': '删除会话？',
    'delete.desc': t => `「${t}」将被永久删除，此操作不可恢复。`,
    'delete.confirm': '删除',
    'profile.badge': p => p,
  }
}

// 语言状态 hook：auto=跟随 app locale；zh/en=手动强制（持久化）
function useLangT() {
  const { locale } = useI18n()
  const [lang, setLangState] = useState(() => apiStorage.get(LANG_STORAGE_KEY, 'auto'))
  const resolved = lang === 'auto'
    ? (locale === 'zh' || locale === 'zh-hant' ? 'zh' : 'en')
    : lang
  const t = useMemo(() => (key, ...args) => {
    const bundle = MESSAGES[resolved] || MESSAGES.en
    const v = bundle[key]
    return typeof v === 'function' ? v(...args) : (v ?? key)
  }, [resolved])
  const setLang = l => {
    setLangState(l)
    apiStorage.set(LANG_STORAGE_KEY, l)
  }
  return { t, lang, resolved, setLang }
}

// ---------------------------------------------------------------- 工具函数

function fmtTime(ts, t) {
  if (!ts) return '—'
  const now = Number(ts)
  if (!Number.isFinite(now) || now <= 0) return '—'
  const d = new Date(now * 1000)
  const diff = Math.max(0, Date.now() - now * 1000)
  if (diff < 60_000) return t('time.just_now')
  if (diff < 3_600_000) return t('time.minutes_ago', Math.floor(diff / 60_000))
  if (diff < 86_400_000) return t('time.hours_ago', Math.floor(diff / 3_600_000))
  if (diff < 172_800_000) return t('time.yesterday')
  if (diff < 7 * 86_400_000) return t('time.days_ago', Math.floor(diff / 86_400_000))
  const pad = n => String(n).padStart(2, '0')
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return sameYear
    ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtClock(ts) {
  if (!ts) return ''
  const now = Number(ts)
  if (!Number.isFinite(now) || now <= 0) return ''
  const d = new Date(now * 1000)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const PLATFORM_LABELS = {
  feishu: 'Feishu', telegram: 'Telegram', discord: 'Discord', slack: 'Slack',
  whatsapp: 'WhatsApp', signal: 'Signal', matrix: 'Matrix', mattermost: 'Mattermost',
  email: 'Email', sms: 'SMS', cron: 'Scheduled',
  weixin: 'WeChat', wechat: 'WeChat', dingtalk: 'DingTalk', wecom: 'WeCom',
  teams: 'Teams', instagram: 'Instagram', facebook: 'Facebook Messenger',
  messenger: 'Messenger', line: 'Line', viber: 'Viber', googlechat: 'Google Chat',
  irc: 'IRC', webhook: 'Webhook', api: 'API', web: 'Web',
  cli: 'Local', tui: 'Local', desktop: 'Local'
}

function platformLabel(source) {
  return PLATFORM_LABELS[source] || source || '?'
}

function chatTypeKey(s) {
  const tt = s.chat_type
  if (tt === 'dm' || tt === 'p2p') return 'dm'
  if (tt === 'group' || tt === 'chat') return 'group'
  if (tt === 'topic' || tt === 'thread') return 'topic'
  return 'none'
}

function chatTypeLabel(s, t) {
  const k = chatTypeKey(s)
  if (k === 'dm') return t('type.dm')
  if (k === 'group') return t('type.group')
  if (k === 'topic') return t('type.topic')
  return '—'
}

function sessionDisplayTitle(s, t) {
  return s.title?.trim() || t('untitled')
}

function timeOf(s) {
  return Number(s.last_activity_at || s.started_at || 0)
}

/** user_id 通用短格式（各平台 ID 语义不同，无法反查时显示可读形态） */
function userFallback(s, t) {
  const uid = s.user_id
  if (!uid) return t('person.unknown')
  const source = s.source || ''
  if (uid.startsWith('ou_')) return t('person.feishu_user')
  if (uid.startsWith('on_')) return t('person.feishu_user')
  if (/^\d+$/.test(uid)) return t('person.user', uid.slice(-4))
  if (uid.length > 10) return `${uid.slice(0, 8)}…`
  return uid
}

/** 会话对象键：person:uid / group:cid / topic:cid:tid / local；对所有平台生效 */
function objectKey(s) {
  if (s.source === 'desktop' || s.source === 'cli' || s.source === 'tui') return 'local'
  if (s.source === 'feishu') {
    return s.chat_type === 'group' ? `group:${s.chat_id || 'g'}` : `person:${s.user_id || 'u'}`
  }
  // 其他平台：群/频道 → group:chat_id；话题 → 独立对象；私聊 → person:user_id
  if (s.chat_type === 'group' || s.chat_type === 'chat') return `group:${s.chat_id || 'g'}`
  if (s.chat_type === 'topic' || s.chat_type === 'thread') return `topic:${s.chat_id || 'g'}:${s.thread_id || 't'}`
  return `person:${s.user_id || 'u'}`
}

/** 会话对象显示名（通用化）：群聊=群名，私聊=用户名，话题=群名+话题，本地=本地会话 */
function objectLabel(s, t) {
  if (s.source === 'desktop' || s.source === 'cli' || s.source === 'tui') return t('local.label')
  const k = chatTypeKey(s)
  if (k === 'group') {
    if (s.display_name && !s.display_name.startsWith('oc_')) return s.display_name
    return s.display_name || t('group.fallback', platformLabel(s.source))
  }
  if (k === 'topic') {
    const base = (s.display_name && !s.display_name.startsWith('oc_')) ? s.display_name : t('topic.fallback', platformLabel(s.source))
    return base
  }
  // 私聊
  return s.user_name || userFallback(s, t)
}

// ---------------------------------------------------------------- 筛选选项构建

function buildFilterOptions(all, t, favorites = []) {
  const platformMap = new Map()
  for (const s of all) {
    const k = s.source || 'unknown'
    platformMap.set(k, (platformMap.get(k) || 0) + 1)
  }
  const platforms = [...platformMap.entries()]
    .map(([k, count]) => ({ key: k, label: platformLabel(k), count }))
    .sort((a, b) => b.count - a.count)

  const personMap = new Map()
  const groupMap = new Map()
  let localCount = 0
  for (const s of all) {
    if (objectKey(s) === 'local') { localCount += 1; continue }
    const k = chatTypeKey(s)
    if (k === 'group' || k === 'topic') {
      const key = objectKey(s)
      if (!groupMap.has(key)) groupMap.set(key, { key, label: objectLabel(s, t), count: 0 })
      groupMap.get(key).count += 1
    } else {
      const key = objectKey(s)
      if (!personMap.has(key)) personMap.set(key, { key, label: objectLabel(s, t), count: 0 })
      personMap.get(key).count += 1
    }
  }
  const persons = [...personMap.values()].sort((a, b) => b.count - a.count)
  const groups = [...groupMap.values()].sort((a, b) => b.count - a.count)

  const pinned = all.filter(s => s.pinned).length
  const archived = all.filter(s => s.archived).length
  const favoriteCount = all.filter(s => favorites.includes(s.id)).length
  const statuses = [
    { key: 'all', label: t('filter.all') },
    ...(favoriteCount ? [{ key: 'favorites', label: t('filter.favorites'), count: favoriteCount }] : []),
    ...(pinned ? [{ key: 'pinned', label: t('filter.pinned'), count: pinned }] : []),
    ...(archived ? [{ key: 'archived', label: t('filter.archived'), count: archived }] : [])
  ]
  const typeMap = new Map()
  for (const s of all) {
    const k = chatTypeKey(s)
    typeMap.set(k, (typeMap.get(k) || 0) + 1)
  }
  const types = [
    { key: 'all', label: t('filter.all') },
    ...[...typeMap.entries()].map(([k, count]) => ({ key: k, label: chatTypeLabel({ chat_type: k }, t) === '—' ? t('type.other') : chatTypeLabel({ chat_type: k }, t), count }))
  ]
  return { platforms, persons, groups, localCount, statuses, types }
}

// ---------------------------------------------------------------- 过滤

function matchesAll(s, f) {
  if (f.platform !== 'all' && (s.source || 'unknown') !== f.platform) return false
  if (f.person !== 'all') {
    if (f.person === 'local') {
      if (objectKey(s) !== 'local') return false
    } else if (objectKey(s) !== f.person) {
      return false
    }
  }
  if (f.status === 'pinned' && !s.pinned) return false
  if (f.status === 'archived' && !s.archived) return false
  if (f.status === 'favorites' && !(f.favorites || []).includes(s.id)) return false
  if (f.type !== 'all' && chatTypeKey(s) !== f.type) return false
  if (f.category && f.category !== 'all') {
    const cats = f.sessionCats[s.id] || []
    if (!cats.includes(f.category)) return false
  }
  const q = f.query.trim().toLowerCase()
  if (q) {
    const hay = [s.title, s.user_name, s.user_id, s.display_name, s.source, s.chat_id, objectLabel(s)]
      .filter(Boolean).join(' ').toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

// ---------------------------------------------------------------- 消息渲染

const LONG_MESSAGE_THRESHOLD = 600

function MessageItem({ m, t }) {
  if (m.role === 'session_meta') return null
  const content = (m.content || '').trim()
  const isTool = m.role === 'tool'
  const isLong = content.length > LONG_MESSAGE_THRESHOLD
  const [expanded, setExpanded] = useState(() => !isTool && !isLong)

  if (isTool) {
    // 工具调用：默认折叠为一行，点击展开完整内容
    return jsxs('div', { className: 'flex gap-2 rounded-md bg-(--ui-bg-tertiary)/40 px-2.5 py-1.5 text-xs text-(--ui-text-quaternary)', children: [
      jsx(Codicon, { name: 'tools', className: 'mt-0.5 shrink-0' }),
      jsxs('div', { className: 'min-w-0 flex-1', children: [
        jsxs('div', { className: 'flex items-center gap-2', children: [
          jsx('span', { className: 'font-medium text-(--ui-text-tertiary)', children: m.tool_name || t('msg.tool') }),
          jsx('button', {
            className: 'shrink-0 text-[10px] text-(--ui-accent) hover:underline',
            onClick: () => setExpanded(!expanded),
            children: expanded ? t('msg.collapse') : t('msg.expand', content.length)
          })
        ]}),
        expanded ? jsx('div', { className: 'mt-1 break-all whitespace-pre-wrap', children: content }) : null
      ]})
    ]})
  }

  const body = expanded ? content : content.slice(0, LONG_MESSAGE_THRESHOLD)
  const isUser = m.role === 'user'
  return jsxs('div', { className: 'flex gap-2.5', children: [
    jsxs('div', { className: 'flex flex-col items-center gap-1 pt-0.5', children: [
      jsx('span', {
        className: 'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ' +
          (isUser ? 'bg-(--ui-accent) text-white' : 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)'),
        children: isUser ? t('msg.user') : t('msg.ai')
      }),
      jsx('span', { className: 'text-[9px] text-(--ui-text-quaternary)', children: fmtClock(m.timestamp) })
    ]}),
    jsxs('div', { className: 'min-w-0 flex-1 space-y-1', children: [
      jsx('div', {
        className: 'rounded-lg bg-(--ui-bg-tertiary)/40 px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap',
        children: body || (isUser ? t('msg.empty.user') : t('msg.empty.assistant'))
      }),
      isLong ? jsx('button', {
        className: 'text-[11px] text-(--ui-accent) hover:underline',
        onClick: () => setExpanded(!expanded),
        children: expanded ? t('msg.collapse') : t('msg.expand', content.length)
      }) : null,
      m.compacted ? jsx('div', { className: 'text-[10px] text-(--ui-text-quaternary)', children: t('msg.compacted') }) : null
    ]})
  ]})
}

// ---------------------------------------------------------------- 会话行

function SessionRow({ s, active, showPerson, onOpen, onRename, onTogglePin, onToggleArchive, onDelete, onToggleCategory, onToggleFavorite, categories, sessionCats, favorites, t }) {
  const person = showPerson ? objectLabel(s, t) : null
  const typeLabel = chatTypeLabel(s, t)
  const preview = (s.preview || '').trim()
  const myCats = sessionCats[s.id] || []
  const isFav = favorites.includes(s.id)
  return jsxs('div', {
    className: 'group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ' +
      (active ? 'bg-(--ui-control-active-background)' : 'hover:bg-(--ui-bg-tertiary)'),
    onClick: () => onOpen(s),
    children: [
      jsx('div', { className: 'w-4 shrink-0 text-center', children: isFav
        ? jsx(Codicon, { name: 'star-full', className: 'text-(--ui-accent)' })
        : s.pinned
          ? jsx(Codicon, { name: 'pinned', className: 'text-(--ui-accent)' })
          : s.archived ? jsx(Codicon, { name: 'archive', className: 'text-(--ui-text-quaternary)' }) : null }),
      jsxs('div', { className: 'min-w-0 flex-1', children: [
        jsxs('div', { className: 'flex min-w-0 items-center gap-2', children: [
          jsx('span', { className: 'truncate text-sm font-medium', children: sessionDisplayTitle(s, t) }),
          typeLabel !== '—' ? jsx(Badge, { variant: 'outline', className: 'shrink-0 text-[10px]', children: typeLabel }) : null,
          ...myCats.map(cid => {
            const cat = categories.find(c => c.id === cid)
            return cat ? jsx(Badge, { key: cid, className: 'shrink-0 max-w-60 truncate text-[10px]', children: cat.name }) : null
          }),
          s.profile !== 'default' ? jsx(Badge, { className: 'shrink-0 text-[10px]', children: s.profile }) : null
        ]}),
        jsxs('div', { className: 'mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-(--ui-text-tertiary)', children: [
          person ? jsxs(Fragment, { children: [
            jsx('span', { className: 'shrink-0 font-medium text-(--ui-text-secondary)', children: person }),
            jsx('span', { className: 'shrink-0', children: '·' })
          ]}) : null,
          preview
            ? jsx('span', { className: 'truncate', children: preview })
            : jsx('span', { className: 'text-(--ui-text-quaternary)', children: '·' })
        ]})
      ]}),
      jsxs('div', { className: 'flex shrink-0 items-center gap-2 text-xs text-(--ui-text-quaternary)', children: [
        s.message_count ? jsx('span', { className: 'tabular-nums', children: `${s.message_count}` }) : null,
        jsx('span', { className: 'w-14 text-right tabular-nums', children: fmtTime(timeOf(s), t) }),
        jsx('div', { className: 'shrink-0', onClick: e => e.stopPropagation(), children: jsx(DropdownMenu, {
          children: [
            jsx(DropdownMenuTrigger, { asChild: true, children: jsx(Button, {
              variant: 'ghost', size: 'sm', className: 'opacity-0 group-hover:opacity-100', 'aria-label': '会话操作',
              children: jsx(Codicon, { name: 'kebab-vertical' })
            })}),
            jsx(DropdownMenuContent, { align: 'end', children: [
              jsx(DropdownMenuItem, { onSelect: () => onOpen(s), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'link' }), t('action.open')] })}),
              jsx(DropdownMenuItem, { onSelect: () => onRename(s), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'edit' }), t('action.rename')] })}),
              categories.length ? jsxs(Fragment, { children: [
                jsx(DropdownMenuSeparator, {}),
                jsx('div', { className: 'px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-quaternary)', children: t('filter.category.assign') }),
                ...categories.map(cat => jsx(DropdownMenuItem, {
                  key: cat.id, onSelect: () => onToggleCategory(s, cat.id),
                  children: jsxs('span', { className: 'flex items-center gap-2', children: [
                    jsx(Codicon, { name: myCats.includes(cat.id) ? 'check' : 'tag', className: myCats.includes(cat.id) ? 'text-(--ui-accent)' : '' }),
                    jsx('span', { className: 'truncate', children: cat.name })
                  ]})
                }))
              ]}) : null,
              jsx(DropdownMenuSeparator, {}),
              jsx(DropdownMenuItem, { onSelect: () => onToggleFavorite(s), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: isFav ? 'star-full' : 'star-empty' }), isFav ? t('action.unfavorite') : t('action.favorite')] })}),
              jsx(DropdownMenuItem, { onSelect: () => onTogglePin(s), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'pinned' }), s.pinned ? t('action.unpin') : t('action.pin')] })}),
              jsx(DropdownMenuItem, { onSelect: () => onToggleArchive(s), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'archive' }), s.archived ? t('action.unarchive') : t('action.archive')] })}),
              jsx(DropdownMenuSeparator, {}),
              jsx(DropdownMenuItem, { onSelect: () => onDelete(s), variant: 'destructive', children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'trash' }), t('action.delete')] })})
            ]})
          ]
        })})
      ]})
    ]
  })
}

// 筛选项（chips）
function FilterChip({ active, count, label, onClick }) {
  return jsx(Button, {
    size: 'sm', variant: active ? 'secondary' : 'ghost', onClick, className: 'shrink-0',
    children: jsxs('span', { className: 'flex items-center gap-1', children: [
      jsx('span', { children: label }),
      count != null ? jsx('span', { className: 'text-[10px] tabular-nums opacity-70', children: count }) : null
    ]})
  })
}

function FilterSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return jsxs('div', { className: 'space-y-1', children: [
    jsx('button', {
      className: 'flex w-full items-center gap-1 rounded px-1 pb-0.5 pt-1 text-left hover:bg-(--ui-bg-tertiary)',
      onClick: () => setOpen(!open),
      children: [
        jsx(Codicon, { name: open ? 'chevron-down' : 'chevron-right', className: 'shrink-0 text-[11px] text-(--ui-text-quaternary)' }),
        jsx('span', { className: 'text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-quaternary)', children: title })
      ]
    }),
    open ? jsx('div', { className: 'pt-0.5', children }) : null
  ]})
}

function ObjectRow({ item, active, onClick, onDelete }) {
  const initial = (item.label || '?').trim().charAt(0).toUpperCase()
  return jsxs('div', { className: 'group flex w-full items-center gap-1', children: [
    jsxs('button', {
      className: 'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ' +
        (active ? 'bg-(--ui-control-active-background)' : 'hover:bg-(--ui-bg-tertiary)'),
      onClick,
      title: `${item.label}（${item.count}）`,
      children: [
        jsx('span', {
          className: 'flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-(--ui-bg-tertiary) text-[11px] font-semibold text-(--ui-text-secondary)',
          children: initial
        }),
        jsx('span', { className: 'min-w-0 flex-1 truncate text-left text-xs', children: item.label }),
        jsx('span', { className: 'shrink-0 text-[11px] tabular-nums text-(--ui-text-quaternary)', children: item.count })
      ]
    }),
    onDelete && jsx('button', {
      className: 'shrink-0 rounded-md px-1 py-1 text-(--ui-text-quaternary) opacity-0 transition-opacity hover:bg-(--ui-bg-tertiary) hover:text-(--ui-red) group-hover:opacity-100',
      onClick: e => { e.stopPropagation(); onDelete() },
      title: '删除该对象全部会话',
      children: jsx(Codicon, { name: 'trash' })
    })
  ]})
}

// ---------------------------------------------------------------- 重命名对话框

function RenameDialog({ open, session, onClose, onConfirm, t }) {
  const [value, setValue] = useState(session ? session.title || '' : '')
  return jsx(Dialog, { open, onOpenChange: open2 => { if (!open2) onClose() }, children: [
    jsx(DialogContent, { children: [
      jsx(DialogHeader, { children: jsx(DialogTitle, { children: t('rename.title') })}),
      jsx(DialogDescription, { className: 'text-xs text-(--ui-text-tertiary)', children: t('rename.desc') }),
      jsx(Input, { value, autoFocus: true, onChange: e => setValue(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()) } }),
      jsx(DialogFooter, { children: [
        jsx(Button, { variant: 'ghost', onClick: onClose, children: t('rename.cancel') }),
        jsx(Button, { disabled: !value.trim(), onClick: () => onConfirm(value.trim()), children: t('rename.save') })
      ]})
    ]})
  ]})
}

// ---------------------------------------------------------------- 分类对话框（新建/重命名共用）

function CategoryDialog({ open, title, initialValue = '', placeholder, onClose, onConfirm, t }) {
  const [value, setValue] = useState(initialValue)
  // 打开时重置为初始值
  useEffect(() => { if (open) setValue(initialValue) }, [open, initialValue])
  return jsx(Dialog, { open, onOpenChange: open2 => { if (!open2) onClose() }, children: [
    jsx(DialogContent, { children: [
      jsx(DialogHeader, { children: jsx(DialogTitle, { children: title })}),
      jsx(Input, { value, autoFocus: true, placeholder,
        onChange: e => setValue(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()) } }),
      jsx(DialogFooter, { children: [
        jsx(Button, { variant: 'ghost', onClick: onClose, children: t('rename.cancel') }),
        jsx(Button, { disabled: !value.trim(), onClick: () => onConfirm(value.trim()), children: t('rename.save') })
      ]})
    ]})
  ]})
}

// ---------------------------------------------------------------- 主页面

function ChannelSessionsPage() {
  const queryClient = useQueryClient()
  const { t, lang, setLang } = useLangT()
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, ...apiStorage.get(UI_STORAGE_KEY, {}) }))
  const saveFilters = patch => setFilters(prev => {
    const next = { ...prev, ...patch }
    apiStorage.set(UI_STORAGE_KEY, next)
    return next
  })
  const [selectedId, setSelectedId] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState(null) // {key, label, count}
  const bulkDeleteMut = useMutation({
    mutationFn: key => apiRest('/delete-by-object', { method: 'POST', body: { object_key: key } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      setBulkDeleteTarget(null)
      setFilters(prev => ({ ...prev, person: 'all' }))
      host.notify({ kind: 'success', message: '已删除该对象全部会话' })
    }
  })

  // 自定义分类：categories=[{id,name}]，sessionCats={sessionId:[catId]}
  const [categories, setCategories] = useState(() => apiStorage.get(CATEGORIES_KEY, []))
  const [sessionCats, setSessionCats] = useState(() => apiStorage.get(SESSION_CATS_KEY, {}))
  const saveCategories = next => {
    setCategories(next)
    apiStorage.set(CATEGORIES_KEY, next)
  }
  const saveSessionCats = next => {
    setSessionCats(next)
    apiStorage.set(SESSION_CATS_KEY, next)
  }
  const [catDialog, setCatDialog] = useState(null) // {mode:'new'|'rename', cat?}
  const [catDeleteTarget, setCatDeleteTarget] = useState(null)

  // 收藏：favorites=[sessionId]（对标 Pi Session Manager / Loominary 的 favorites）
  const [favorites, setFavorites] = useState(() => apiStorage.get(FAVORITES_KEY, []))
  const saveFavorites = next => {
    setFavorites(next)
    apiStorage.set(FAVORITES_KEY, next)
  }
  const toggleFavorite = s => {
    const has = favorites.includes(s.id)
    saveFavorites(has ? favorites.filter(x => x !== s.id) : [...favorites, s.id])
  }
  // 导出为 Markdown（对标 Pi Session Manager / Loominary 的导出能力）
  const doExport = async s => {
    try {
      const res = await apiRest(`/export?session_id=${encodeURIComponent(s.id)}&profile=${encodeURIComponent(s.profile || 'default')}`)
      const md = res && res.markdown
      if (!md) throw new Error('empty export')
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeTitle = (res.title || s.id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
      a.href = url
      a.download = `${safeTitle}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      host.notify({ kind: 'error', message: t('action.export.failed') })
    }
  }

  const sessionsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiRest('/sessions?limit=1000'),
    refetchInterval: REFRESH_INTERVAL_MS
  })

  const mutation = useMutation({
    mutationFn: ({ path, body }) => apiRest(path, { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  })

  const data = sessionsQuery.data || { sessions: [], names: {} }
  const all = (data.sessions || []).filter(s => s.source && s.source !== 'cli' && s.source !== 'tui')

  const options = useMemo(() => buildFilterOptions(all, t, favorites), [all, t, favorites])

  // 失效筛选自动回退
  const validFilters = useMemo(() => {
    const f = { ...filters }
    if (f.platform !== 'all' && !options.platforms.some(p => p.key === f.platform)) f.platform = 'all'
    if (f.person !== 'all' && f.person !== 'local') {
      const exists = [...options.persons, ...options.groups].some(o => o.key === f.person)
      if (!exists) f.person = 'all'
    }
    if (f.person === 'local' && !options.localCount) f.person = 'all'
    if (f.status === 'pinned' && !all.some(s => s.pinned)) f.status = 'all'
    if (f.status === 'archived' && !all.some(s => s.archived)) f.status = 'all'
    if (f.status === 'favorites' && !favorites.length) f.status = 'all'
    if (f.type !== 'all' && !options.types.some(t => t.key === f.type)) f.type = 'all'
    if (f.category && f.category !== 'all' && !categories.some(c => c.id === f.category)) f.category = 'all'
    return f
  }, [filters, options, categories, all, favorites])

  const filtered = useMemo(() => {
    const f = { ...validFilters, sessionCats, favorites }
    return all.filter(s => matchesAll(s, f)).sort((a, b) => timeOf(b) - timeOf(a))
  }, [all, validFilters, sessionCats, favorites])

  // 选中会话（从最新数据里找，标题随刷新更新）
  const selected = selectedId ? (all.find(s => s.id === selectedId) || null) : null

  // 消息分页：offset 累积加载更早消息（后端按插入序分页，offset=已加载条数）
  const MESSAGE_PAGE = 200
  const [msgOffset, setMsgOffset] = useState(0)
  const [loadedMsgs, setLoadedMsgs] = useState([])
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false)

  // 切换会话时重置分页
  useEffect(() => {
    setMsgOffset(0)
    setLoadedMsgs([])
    setHasMoreMsgs(false)
  }, [selected ? selected.id : null])

  const messagesQuery = useQuery({
    queryKey: [ID, 'messages', selected ? selected.id : null, msgOffset],
    queryFn: () => selected
      ? apiRest(`/messages?session_id=${encodeURIComponent(selected.id)}&profile=${encodeURIComponent(selected.profile || 'default')}&limit=${MESSAGE_PAGE}&offset=${msgOffset}`)
      : null,
    enabled: !!selected,
    refetchInterval: msgOffset === 0 ? MESSAGES_REFETCH_MS : false
  })

  // 分页数据并入累积列表
  useEffect(() => {
    const data = messagesQuery.data
    if (!data || !Array.isArray(data.messages)) return
    setLoadedMsgs(prev => {
      const known = new Set(prev.map(m => m.id))
      const fresh = data.messages.filter(m => m.id != null && !known.has(m.id))
      return [...prev, ...fresh]
    })
    setHasMoreMsgs(!!data.has_more)
  }, [messagesQuery.data])

  const loadMore = () => {
    if (messagesQuery.isFetching) return
    setMsgOffset(prev => prev + MESSAGE_PAGE)
  }

  const pinnedCount = all.filter(s => s.pinned).length
  const archivedCount = all.filter(s => s.archived).length
  const activeCount = [validFilters.platform, validFilters.person, validFilters.status, validFilters.type, validFilters.category]
    .filter(v => v !== 'all').length + (validFilters.query.trim() ? 1 : 0)

  const activeParts = []
  if (validFilters.platform !== 'all') activeParts.push(platformLabel(validFilters.platform))
  if (validFilters.person !== 'all') {
    const o = [...options.persons, ...options.groups].find(x => x.key === validFilters.person)
    activeParts.push(o ? o.label : (validFilters.person === 'local' ? t('filter.local') : validFilters.person))
  }
  if (validFilters.status === 'pinned') activeParts.push(t('filter.pinned'))
  if (validFilters.status === 'archived') activeParts.push(t('filter.archived'))
  if (validFilters.status === 'favorites') activeParts.push(t('filter.favorites'))
  if (validFilters.type !== 'all') {
    const tt = options.types.find(x => x.key === validFilters.type)
    if (tt) activeParts.push(tt.label)
  }
  if (validFilters.category !== 'all') {
    const cat = categories.find(c => c.id === validFilters.category)
    if (cat) activeParts.push(cat.name)
  }

  const doRename = title => {
    const s = renameTarget
    if (!s) return
    mutation.mutate({ path: '/rename', body: { session_id: s.id, profile: s.profile || 'default', title } })
    setRenameTarget(null)
  }
  const doTogglePin = s => mutation.mutate({ path: '/pin', body: { session_id: s.id, profile: s.profile || 'default', pinned: !s.pinned } })
  const doToggleArchive = s => mutation.mutate({ path: '/archive', body: { session_id: s.id, profile: s.profile || 'default', archived: !s.archived } })
  const doDelete = async () => {
    const s = deleteTarget
    if (!s) return
    await mutation.mutateAsync({ path: '/delete', body: { session_id: s.id, profile: s.profile || 'default' } })
    setDeleteTarget(null)
    if (selectedId === s.id) setSelectedId(null)
    // 清理该会话的分类映射与收藏
    if (sessionCats[s.id]) {
      const next = { ...sessionCats }
      delete next[s.id]
      saveSessionCats(next)
    }
    if (favorites.includes(s.id)) {
      saveFavorites(favorites.filter(x => x !== s.id))
    }
  }
  // 分类 CRUD
  const createCategory = name => {
    const id = `cat-${Date.now()}`
    saveCategories([...categories, { id, name }])
    setCatDialog(null)
  }
  const renameCategory = name => {
    if (!catDialog || !catDialog.cat) return
    saveCategories(categories.map(c => (c.id === catDialog.cat.id ? { ...c, name } : c)))
    setCatDialog(null)
  }
  const confirmDeleteCategory = () => {
    if (!catDeleteTarget) return
    const id = catDeleteTarget.id
    saveCategories(categories.filter(c => c.id !== id))
    const next = {}
    for (const [sid, ids] of Object.entries(sessionCats)) {
      const rest = ids.filter(x => x !== id)
      if (rest.length) next[sid] = rest
    }
    saveSessionCats(next)
    if (validFilters.category === id) saveFilters({ category: 'all' })
    setCatDeleteTarget(null)
  }
  const toggleSessionCategory = (s, catId) => {
    const cur = sessionCats[s.id] || []
    const has = cur.includes(catId)
    const nextCats = has ? cur.filter(x => x !== catId) : [...cur, catId]
    saveSessionCats({ ...sessionCats, [s.id]: nextCats })
  }
  const openSession = s => {
    if (s.id) host.navigate(`/${encodeURIComponent(s.id)}`)
  }
  const toggleSelect = s => setSelectedId(prev => (prev === s.id ? null : s.id))
  const clearAll = () => saveFilters(DEFAULT_FILTERS)

  const showPerson = !(validFilters.person !== 'all')
  const msgs = loadedMsgs
  const visibleMsgs = msgs.filter(m => m.role !== 'session_meta')

  return jsxs('div', { className: 'flex h-full flex-col', children: [
    // 头部
    jsxs('header', { className: 'flex items-center justify-between gap-3 border-b border-(--ui-stroke-secondary) px-4 py-2.5', children: [
      jsxs('div', { className: 'flex items-center gap-2', children: [
        jsx(Codicon, { name: 'organization', className: 'text-(--ui-text-secondary)' }),
        jsx('h1', { className: 'text-sm font-semibold', children: t('title') }),
        jsx('span', { className: 'text-xs text-(--ui-text-tertiary)', children: t('count', all.length) }),
        pinnedCount > 0 ? jsx(Badge, { className: 'text-[10px]', children: `${t('filter.pinned')} ${pinnedCount}` }) : null,
        archivedCount > 0 ? jsx(Badge, { variant: 'outline', className: 'text-[10px]', children: `${t('filter.archived')} ${archivedCount}` }) : null
      ]}),
      jsxs('div', { className: 'flex items-center gap-2', children: [
        jsx('span', { className: 'text-[11px] font-medium uppercase tracking-wide text-(--ui-text-quaternary)', children: t('lang.label') }),
        jsx(SegmentedControl, {
          value: lang, onChange: setLang,
          options: [
            { id: 'auto', label: t('lang.auto') },
            { id: 'zh', label: t('lang.zh') },
            { id: 'en', label: t('lang.en') }
          ]
        }),
        jsx(Button, {
          variant: 'ghost', size: 'sm', onClick: () => sessionsQuery.refetch(),
          disabled: sessionsQuery.isFetching, title: t('refresh'),
          children: sessionsQuery.isFetching ? jsx(GlyphSpinner, {}) : jsx(Codicon, { name: 'refresh' })
        })
      ]})
    ]}),
    // 主体：左导航 | 会话列表 | 消息详情
    jsxs('div', { className: 'flex min-h-0 flex-1', children: [
      // 左栏：筛选
      jsxs('aside', { className: 'flex w-64 shrink-0 flex-col border-r border-(--ui-stroke-secondary)', children: [
        jsx('div', { className: 'px-3 py-2', children: jsx(SearchField, {
          value: validFilters.query, onChange: q => saveFilters({ query: q }),
          placeholder: t('search.placeholder'), containerClassName: 'w-full'
        })}),
        jsx(ScrollArea, { className: 'flex-1 px-2 pb-3', children: jsxs('div', { className: 'space-y-3', children: [
          jsx(FilterSection, { title: t('filter.platform'), children: jsx('div', { className: 'flex flex-wrap gap-1 px-1', children: [
            jsx(FilterChip, { active: validFilters.platform === 'all', label: t('filter.all'), onClick: () => saveFilters({ platform: 'all' }) }),
            ...options.platforms.map(p => jsx(FilterChip, {
              key: p.key, active: validFilters.platform === p.key, label: p.label, count: p.count,
              onClick: () => saveFilters({ platform: validFilters.platform === p.key ? 'all' : p.key })
            }))
          ]})}),
          jsx(FilterSection, { title: t('filter.person'), children: jsxs('div', { className: 'space-y-0.5', children: [
            ...(options.persons.length ? [
              ...options.persons.map(o => jsx(ObjectRow, { key: o.key, item: o, active: validFilters.person === o.key, onClick: () => saveFilters({ person: validFilters.person === o.key ? 'all' : o.key }), onDelete: () => setBulkDeleteTarget({ key: o.key, label: o.label, count: o.count }) }))
            ] : []),
            ...(options.groups.length ? [
              jsx('div', { key: 'group-sep', className: 'px-1 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-quaternary)', children: t('filter.groups') }),
              ...options.groups.map(o => jsx(ObjectRow, { key: o.key, item: o, active: validFilters.person === o.key, onClick: () => saveFilters({ person: validFilters.person === o.key ? 'all' : o.key }), onDelete: () => setBulkDeleteTarget({ key: o.key, label: o.label, count: o.count }) }))
            ] : []),
            options.localCount ? jsx(ObjectRow, { item: { key: 'local', label: t('filter.local'), count: options.localCount }, active: validFilters.person === 'local', onClick: () => saveFilters({ person: validFilters.person === 'local' ? 'all' : 'local' }) }) : null
          ]})}),
          jsx(FilterSection, { title: t('filter.status'), children: jsx('div', { className: 'flex flex-wrap gap-1 px-1', children: options.statuses.map(st => jsx(FilterChip, {
            key: st.key, active: validFilters.status === st.key, label: st.label, count: st.count,
            onClick: () => saveFilters({ status: validFilters.status === st.key ? 'all' : st.key })
          }))})}),
          jsx(FilterSection, { title: t('filter.type'), children: jsx('div', { className: 'flex flex-wrap gap-1 px-1', children: options.types.map(ty => jsx(FilterChip, {
            key: ty.key, active: validFilters.type === ty.key, label: ty.label, count: ty.count,
            onClick: () => saveFilters({ type: validFilters.type === ty.key ? 'all' : ty.key })
          }))})}),
          jsx(FilterSection, { title: t('filter.category'), children: jsxs('div', { className: 'space-y-0.5', children: [
            categories.length
              ? [
                  ...categories.map(cat => {
                    const count = all.filter(s => (sessionCats[s.id] || []).includes(cat.id)).length
                    return jsx('div', {
                      key: cat.id,
                      className: 'group flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ' +
                        (validFilters.category === cat.id ? 'bg-(--ui-control-active-background)' : 'hover:bg-(--ui-bg-tertiary)'),
                      children: [
                        jsx('button', {
                          className: 'flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left',
                          onClick: () => saveFilters({ category: validFilters.category === cat.id ? 'all' : cat.id }),
                          children: [
                            jsx(Codicon, { name: 'tag', className: 'shrink-0 text-[12px] text-(--ui-text-tertiary)' }),
                            jsx('span', { className: 'min-w-0 flex-1 truncate text-xs', children: cat.name }),
                            jsx('span', { className: 'shrink-0 text-[11px] tabular-nums text-(--ui-text-quaternary)', children: count })
                          ]
                        }),
                        jsx('div', { className: 'flex shrink-0 items-center', children: [
                          jsx('button', {
                            className: 'rounded p-0.5 text-(--ui-text-quaternary) hover:text-(--ui-text-secondary)',
                            title: t('filter.category.rename'),
                            onClick: () => setCatDialog({ mode: 'rename', cat }),
                            children: jsx(Codicon, { name: 'edit', className: 'text-[11px]' })
                          }),
                          jsx('button', {
                            className: 'rounded p-0.5 text-(--ui-text-quaternary) hover:text-destructive',
                            title: t('filter.category.delete'),
                            onClick: () => setCatDeleteTarget(cat),
                            children: jsx(Codicon, { name: 'trash', className: 'text-[11px]' })
                          })
                        ]})
                      ]
                    })
                  })
                ]
              : jsx('div', { className: 'px-1 py-1 text-xs text-(--ui-text-quaternary)', children: t('filter.category.empty') }),
            jsx('button', {
              className: 'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-(--ui-accent) hover:bg-(--ui-bg-tertiary)',
              onClick: () => setCatDialog({ mode: 'new' }),
              children: [jsx(Codicon, { name: 'add', className: 'text-[12px]' }), t('filter.category.new')]
            })
          ]})})
        ]})})
      ]}),
      // 中栏：会话列表
      jsxs('div', { className: 'flex w-80 shrink-0 flex-col border-r border-(--ui-stroke-secondary)', children: [
        jsxs('div', { className: 'flex min-h-7 items-center gap-2 border-b border-(--ui-stroke-secondary) px-3 py-1.5 text-xs text-(--ui-text-tertiary)', children: [
          jsx('span', { className: 'font-medium text-(--ui-text-secondary)', children: activeCount ? activeParts.join(' · ') : t('list.all') }),
          jsx('span', { children: '·' }),
          jsx('span', { children: `${filtered.length}` }),
          validFilters.query.trim() ? jsx('span', { className: 'truncate', children: t('filter.searching', validFilters.query.trim()) }) : null,
          activeCount > 0 ? jsx(Button, { size: 'sm', variant: 'ghost', className: 'ml-auto', onClick: clearAll, children: t('filter.clear') }) : null
        ]}),
        jsx(ScrollArea, { className: 'flex-1', children:
          sessionsQuery.isLoading
            ? jsx('div', { className: 'flex h-full items-center justify-center py-10', children: jsx(GlyphSpinner, {}) })
            : sessionsQuery.isError
              ? jsx(ErrorState, { title: t('list.loading.failed'), description: t('list.loading.failed.desc') })
              : !filtered.length
                ? jsx(EmptyState, { title: t('list.empty'), description: t('list.empty.desc') })
                : jsx('div', { className: 'px-2 py-2', children: filtered.map(s => jsx(SessionRow, {
                    key: s.id, s, active: selected && selected.id === s.id, showPerson, t,
                    categories, sessionCats, favorites,
                    onOpen: toggleSelect, onRename: setRenameTarget,
                    onTogglePin: doTogglePin, onToggleArchive: doToggleArchive,
                    onToggleCategory: toggleSessionCategory, onToggleFavorite: toggleFavorite,
                    onDelete: setDeleteTarget
                  })) })
        })
      ]}),
      // 右栏：消息详情
      jsxs('div', { className: 'flex min-w-0 flex-1 flex-col', children: [
        selected
          ? jsxs(Fragment, { children: [
              jsxs('div', { className: 'flex items-center gap-2 border-b border-(--ui-stroke-secondary) px-3 py-2', children: [
                jsx(Button, { size: 'sm', variant: 'ghost', onClick: () => setSelectedId(null), title: t('detail.back'),
                  children: jsx(Codicon, { name: 'arrow-left' }) }),
                jsx('div', { className: 'min-w-0 flex-1', children: [
                  jsxs('div', { className: 'flex items-center gap-2', children: [
                    jsx('span', { className: 'truncate text-sm font-semibold', children: sessionDisplayTitle(selected, t) }),
                    ...(sessionCats[selected.id] || []).map(cid => {
                      const cat = categories.find(c => c.id === cid)
                      return cat ? jsx(Badge, { key: cid, className: 'shrink-0 max-w-60 truncate text-[10px]', children: cat.name }) : null
                    }),
                    selected.pinned ? jsx(Codicon, { name: 'pinned', className: 'shrink-0 text-(--ui-accent)' }) : null
                  ]}),
                  jsxs('div', { className: 'mt-0.5 flex items-center gap-1.5 text-xs text-(--ui-text-tertiary)', children: [
                    jsx('span', { className: 'font-medium text-(--ui-text-secondary)', children: objectLabel(selected, t) }),
                    jsx('span', { children: '·' }),
                    jsx('span', { children: platformLabel(selected.source) }),
                    jsx('span', { children: '·' }),
                    jsx('span', { children: t('detail.messages', visibleMsgs.length) })
                  ]})
                ]}),
                jsx(Button, { size: 'sm', variant: 'secondary', onClick: () => openSession(selected), title: t('detail.open.full.title'),
                  children: jsxs('span', { className: 'flex items-center gap-1.5', children: [jsx(Codicon, { name: 'open-new-window' }), t('detail.open.full')] }) }),
                jsx(Button, { size: 'sm', variant: 'secondary', onClick: () => doExport(selected), title: t('action.export.title'),
                  children: jsxs('span', { className: 'flex items-center gap-1.5', children: [jsx(Codicon, { name: 'download' }), t('action.export')] }) }),
                jsx('div', { className: 'shrink-0', children: jsx(DropdownMenu, { children: [
                  jsx(DropdownMenuTrigger, { asChild: true, children: jsx(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('title'), children: jsx(Codicon, { name: 'kebab-vertical' }) })}),
                  jsx(DropdownMenuContent, { align: 'end', children: [
                    jsx(DropdownMenuItem, { onSelect: () => setRenameTarget(selected), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'edit' }), t('action.rename')] })}),
                    categories.length ? jsxs(Fragment, { children: [
                      jsx(DropdownMenuSeparator, {}),
                      jsx('div', { className: 'px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-quaternary)', children: t('filter.category.assign') }),
                      ...categories.map(cat => jsx(DropdownMenuItem, {
                        key: cat.id, onSelect: () => toggleSessionCategory(selected, cat.id),
                        children: jsxs('span', { className: 'flex items-center gap-2', children: [
                          jsx(Codicon, { name: (sessionCats[selected.id] || []).includes(cat.id) ? 'check' : 'tag', className: (sessionCats[selected.id] || []).includes(cat.id) ? 'text-(--ui-accent)' : '' }),
                          jsx('span', { className: 'truncate', children: cat.name })
                        ]})
                      }))
                    ]}) : null,
                    jsx(DropdownMenuSeparator, {}),
                    jsx(DropdownMenuItem, { onSelect: () => toggleFavorite(selected), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: favorites.includes(selected.id) ? 'star-full' : 'star-empty' }), favorites.includes(selected.id) ? t('action.unfavorite') : t('action.favorite')] })}),
                    jsx(DropdownMenuItem, { onSelect: () => doTogglePin(selected), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'pinned' }), selected.pinned ? t('action.unpin') : t('action.pin')] })}),
                    jsx(DropdownMenuItem, { onSelect: () => doToggleArchive(selected), children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'archive' }), selected.archived ? t('action.unarchive') : t('action.archive')] })}),
                    jsx(DropdownMenuSeparator, {}),
                    jsx(DropdownMenuItem, { onSelect: () => setDeleteTarget(selected), variant: 'destructive', children: jsxs('span', { className: 'flex items-center gap-2', children: [jsx(Codicon, { name: 'trash' }), t('action.delete')] })})
                  ]})
                ]})})
              ]}),
              jsx(ScrollArea, { className: 'flex-1', children:
                messagesQuery.isLoading && msgOffset === 0
                  ? jsx('div', { className: 'flex h-full items-center justify-center py-10', children: jsx(GlyphSpinner, {}) })
                  : !visibleMsgs.length
                    ? jsx(EmptyState, { title: t('detail.messages.empty'), description: t('detail.messages.empty.desc') })
                    : jsxs('div', { className: 'space-y-3 px-4 py-3', children: [
                        ...visibleMsgs.map(m => jsx(MessageItem, { key: m.id, m, t })),
                        jsxs('div', { className: 'flex items-center justify-center gap-2 py-2', children: [
                          messagesQuery.isError && msgOffset > 0
                            ? jsx('span', { className: 'text-[11px] text-(--ui-text-quaternary)', children: t('list.loading.failed') })
                            : null,
                          hasMoreMsgs
                            ? jsx(Button, {
                                size: 'sm', variant: 'outline', onClick: loadMore,
                                disabled: messagesQuery.isFetching,
                                children: messagesQuery.isFetching
                                  ? jsxs('span', { className: 'flex items-center gap-1.5', children: [jsx(GlyphSpinner, {}), t('msg.loading')] })
                                  : t('msg.load_more')
                              })
                            : visibleMsgs.length >= MESSAGE_PAGE && msgOffset > 0
                              ? jsx('span', { className: 'text-[11px] text-(--ui-text-quaternary)', children: t('msg.all_loaded') })
                              : null
                        ]})
                      ]})
              })
            ]})
          : jsx('div', { className: 'flex h-full items-center justify-center', children: jsx(EmptyState, {
              title: t('detail.select'),
              description: t('detail.select.desc')
            })})
      ]})
    ]}),
    // 对话框
    jsx(RenameDialog, { key: renameTarget ? renameTarget.id : 'none', open: !!renameTarget, session: renameTarget, onClose: () => setRenameTarget(null), onConfirm: doRename, t }),
    jsx(CategoryDialog, {
      key: catDialog ? (catDialog.mode === 'rename' ? catDialog.cat.id : 'new') : 'none',
      open: !!catDialog,
      title: catDialog && catDialog.mode === 'rename' ? t('filter.category.rename') : t('filter.category.new'),
      initialValue: catDialog && catDialog.mode === 'rename' ? catDialog.cat.name : '',
      placeholder: t('filter.category.name.placeholder'),
      onClose: () => setCatDialog(null),
      onConfirm: catDialog && catDialog.mode === 'rename' ? renameCategory : createCategory,
      t
    }),
    jsx(ConfirmDialog, {
      open: !!catDeleteTarget, onClose: () => setCatDeleteTarget(null), onConfirm: confirmDeleteCategory,
      title: t('filter.category.delete.title'),
      description: catDeleteTarget ? t('filter.category.delete.desc', catDeleteTarget.name) : '',
      confirmLabel: t('delete.confirm'), destructive: true, dismissOnConfirm: true
    }),
    jsx(ConfirmDialog, {
      open: !!deleteTarget, onClose: () => setDeleteTarget(null), onConfirm: doDelete,
      title: t('delete.title'),
      description: deleteTarget ? t('delete.desc', sessionDisplayTitle(deleteTarget, t)) : '',
      confirmLabel: t('delete.confirm'), destructive: true, dismissOnConfirm: true
    }),
    jsx(ConfirmDialog, {
      open: !!bulkDeleteTarget, onClose: () => setBulkDeleteTarget(null),
      onConfirm: () => bulkDeleteMut.mutateAsync(bulkDeleteTarget.key),
      title: '删除该对象全部会话？',
      description: bulkDeleteTarget
        ? `将永久删除「${bulkDeleteTarget.label}」的全部 ${bulkDeleteTarget.count} 个会话，不可恢复。确定继续？`
        : '',
      confirmLabel: `删除 ${bulkDeleteTarget ? bulkDeleteTarget.count : ''} 个会话`,
      destructive: true, dismissOnConfirm: true
    })
  ]})
}

// apiRest / apiStorage 由 register 注入（插件运行时挂载）
let apiRest = (path, opts) => Promise.reject(new Error('插件上下文未就绪'))
let apiStorage = { get: (_k, fb) => fb, set: () => {}, remove: () => {} }

// ---------------------------------------------------------------- 插件入口

export default {
  id: ID,
  name: 'Channel Sessions',
  description: 'Manage gateway sessions by person, platform, status and type — filter, inspect messages, rename, pin, archive, delete.',
  register(ctx) {
    apiRest = (path, opts) => ctx.rest(path, opts)
    apiStorage = ctx.storage
    ctx.register({
      id: 'nav-channel-sessions',
      area: SIDEBAR_NAV_AREA,
      data: { path: ROUTE, label: 'Channel Sessions', codicon: 'organization' }
    })
    ctx.register({
      id: 'page-channel-sessions',
      area: ROUTES_AREA,
      data: { path: ROUTE },
      render: () => jsx(ChannelSessionsPage, {})
    })
    ctx.register({
      id: 'cmd-channel-sessions',
      area: PALETTE_AREA,
      data: { id: 'channel-sessions.open', title: 'Open Channel Sessions', keywords: ['session', 'channel', 'feishu', '会话', '渠道', '飞书'] },
      run: () => host.navigate(ROUTE)
    })
  }
}
