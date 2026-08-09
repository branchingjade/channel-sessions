#!/usr/bin/env node
// 自检：import 未使用检查 + 核心逻辑冒烟测试（含 i18n 双语文案）
const fs = require('fs')
const src = fs.readFileSync(__dirname + '/plugin.js', 'utf8')

// 1. import 检查
const importMatch = src.match(/import \{([\s\S]*?)\} from '@hermes\/plugin-sdk'/)
const imports = importMatch[1].split(',').map(s => s.trim()).filter(Boolean)
const body = src.replace(importMatch[0], '')
const unused = imports.filter(name => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return !new RegExp('\\b' + esc + '\\b').test(body)
})
console.log('[1] import 数:', imports.length, '| 未使用:', unused.length ? unused : '无 ✅')

// 2. 核心逻辑冒烟测试（t 用最小 mock：key => key）
const start = src.indexOf('// ---------------------------------------------------------------- 工具函数')
const end = src.indexOf('// ---------------------------------------------------------------- 消息渲染')
const logic = src.slice(start, end)
const fn = new Function(logic + '; return { objectKey, objectLabel, chatTypeKey, chatTypeLabel, userFallback, platformLabel, buildFilterOptions, matchesAll, fmtTime };')
const m = fn()
const t = key => key

// 分类筛选辅助：构造带 sessionCats 的过滤条件
const withCats = (f, sessionCats) => ({ ...f, sessionCats })

const cases = [
  { name: '飞书私聊对象键', actual: m.objectKey({ source: 'feishu', chat_type: 'dm', user_id: 'ou_1' }), expect: 'person:ou_1' },
  { name: '飞书群聊对象键', actual: m.objectKey({ source: 'feishu', chat_type: 'group', chat_id: 'oc_g' }), expect: 'group:oc_g' },
  { name: '微信私聊对象键', actual: m.objectKey({ source: 'weixin', chat_type: 'dm', user_id: 'wxid_abc' }), expect: 'person:wxid_abc' },
  { name: '本地会话对象键', actual: m.objectKey({ source: 'desktop' }), expect: 'local' },
  { name: '微信群对象名', actual: m.objectLabel({ source: 'weixin', chat_type: 'group', display_name: '剧本讨论组' }, t), expect: '剧本讨论组' },
  { name: '数字ID短格式', actual: m.userFallback({ source: 'telegram', user_id: '123456789' }, t), expect: 'person.user' },
  { name: '微信标签', actual: m.platformLabel('weixin'), expect: 'WeChat' },
  { name: '组合筛选 飞书+人', actual: (() => {
    const all = [
      { source: 'feishu', chat_type: 'dm', user_id: 'ou_1', user_name: '甲', title: 'A' },
      { source: 'feishu', chat_type: 'dm', user_id: 'ou_2', user_name: '乙', title: 'B' },
      { source: 'weixin', chat_type: 'dm', user_id: 'wx_1', title: 'C' }
    ]
    return all.filter(s => m.matchesAll(s, { platform: 'feishu', person: 'person:ou_1', status: 'all', type: 'all', query: '' })).map(s => s.title).join()
  })(), expect: 'A' },
  { name: '搜索命中', actual: (() => {
    const all = [{ source: 'feishu', chat_type: 'group', display_name: '开工', title: 'T1' }]
    return all.filter(s => m.matchesAll(s, { platform: 'all', person: 'all', status: 'all', type: 'all', query: '开工' })).length
  })(), expect: 1 },
  { name: '状态筛选 pinned', actual: (() => {
    const all = [{ source: 'feishu', chat_type: 'dm', user_id: 'u1', pinned: 1, title: 'P' },
                 { source: 'feishu', chat_type: 'dm', user_id: 'u2', pinned: 0, title: 'N' }]
    return all.filter(s => m.matchesAll(s, { platform: 'all', person: 'all', status: 'pinned', type: 'all', query: '' })).length
  })(), expect: 1 },
  { name: '类型筛选 dm', actual: (() => {
    const all = [{ source: 'feishu', chat_type: 'dm', user_id: 'u1', title: 'D' },
                 { source: 'feishu', chat_type: 'group', chat_id: 'g1', title: 'G' }]
    return all.filter(s => m.matchesAll(s, { platform: 'all', person: 'all', status: 'all', type: 'dm', query: '' })).length
  })(), expect: 1 },
  { name: '分类筛选命中', actual: (() => {
    const all = [{ id: 's1', source: 'feishu', chat_type: 'dm', user_id: 'u1', title: 'A' },
                 { id: 's2', source: 'feishu', chat_type: 'dm', user_id: 'u2', title: 'B' }]
    const cats = { s1: ['cat-1'], s2: [] }
    return all.filter(s => m.matchesAll(s, withCats({ platform: 'all', person: 'all', status: 'all', type: 'all', query: '', category: 'cat-1' }, cats))).map(s => s.id).join()
  })(), expect: 's1' },
  { name: '分类筛选全部门禁', actual: (() => {
    const all = [{ id: 's1', source: 'feishu', chat_type: 'dm', user_id: 'u1', title: 'A' }]
    return m.matchesAll(all[0], withCats({ platform: 'all', person: 'all', status: 'all', type: 'all', query: '', category: 'cat-x' }, { s1: ['cat-1'] }))
  })(), expect: false },
  { name: '分类筛选 all 放行', actual: (() => {
    const all = [{ id: 's1', source: 'feishu', chat_type: 'dm', user_id: 'u1', title: 'A' }]
    return m.matchesAll(all[0], withCats({ platform: 'all', person: 'all', status: 'all', type: 'all', query: '', category: 'all' }, {}))
  })(), expect: true },
  { name: '收藏筛选命中', actual: (() => {
    const all = [{ id: 's1', source: 'feishu', chat_type: 'dm', user_id: 'u1', title: 'A' },
                 { id: 's2', source: 'feishu', chat_type: 'dm', user_id: 'u2', title: 'B' }]
    const f = { platform: 'all', person: 'all', status: 'favorites', type: 'all', query: '', category: 'all', favorites: ['s1'] }
    return all.filter(s => m.matchesAll(s, f)).map(s => s.id).join()
  })(), expect: 's1' },
  { name: '收藏筛选无收藏为空', actual: (() => {
    const all = [{ id: 's1', source: 'feishu', chat_type: 'dm', user_id: 'u1', title: 'A' }]
    const f = { platform: 'all', person: 'all', status: 'favorites', type: 'all', query: '', category: 'all', favorites: [] }
    return all.filter(s => m.matchesAll(s, f)).length
  })(), expect: 0 },
  { name: '显示名覆盖优先', actual: m.objectLabel({ source: 'feishu', chat_type: 'dm', user_id: 'ou_1', user_name: '本名' }, t, { 'person:ou_1': '自定义名' }), expect: '自定义名' },
  { name: '无覆盖用原名', actual: m.objectLabel({ source: 'feishu', chat_type: 'dm', user_id: 'ou_1', user_name: '本名' }, t, {}), expect: '本名' }
]
let fail = 0
for (const c of cases) {
  const ok = String(c.actual) === String(c.expect)
  if (!ok) fail++
  console.log(`[2] ${ok ? '✅' : '❌'} ${c.name}: ${JSON.stringify(c.actual)} ${ok ? '' : '≠ ' + JSON.stringify(c.expect)}`)
}

// 3. 时间格式化（t mock）
const now = Math.floor(Date.now() / 1000)
const just = m.fmtTime(now, t)
console.log('[3] fmtTime 当前时间:', just, just === 'time.just_now' ? '✅' : '❌')

// 4. i18n 字典完整性：en/zh 键集合一致
const i18nStart = src.indexOf('const MESSAGES = {')
const i18nEnd = src.indexOf('// 语言状态 hook')
const i18nSrc = src.slice(i18nStart, i18nEnd)
const i18nFn = new Function(i18nSrc + '; return MESSAGES')
const MESSAGES = i18nFn()
const enKeys = Object.keys(MESSAGES.en).sort()
const zhKeys = Object.keys(MESSAGES.zh).sort()
const enOnly = enKeys.filter(k => !zhKeys.includes(k))
const zhOnly = zhKeys.filter(k => !enKeys.includes(k))
if (enOnly.length || zhOnly.length) {
  fail++
  console.log(`[4] ❌ i18n 键不一致 — en 独有: ${enOnly.join(',') || '无'} | zh 独有: ${zhOnly.join(',') || '无'}`)
} else {
  console.log(`[4] ✅ i18n 双语键一致（${enKeys.length} 键）`)
}

// 5. 残留硬编码中文检查（排除注释与字典区）
const bodyNoComments = body
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
const i18nZone = bodyNoComments.slice(0, bodyNoComments.indexOf('const MESSAGES = {'))
const hardcodedZh = i18nZone.match(/[\u4e00-\u9fff]{2,}/g)
if (hardcodedZh) {
  fail++
  console.log('[5] ❌ 硬编码中文残留:', hardcodedZh.join(' | '))
} else {
  console.log('[5] ✅ 无硬编码中文（UI 文案全部走 i18n）')
}

console.log(fail === 0 ? '\n自检结论: 全部通过 ✅' : `\n自检结论: ${fail} 项失败 ❌`)
process.exit(fail === 0 ? 0 : 1)
