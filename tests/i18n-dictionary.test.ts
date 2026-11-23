// 多语言插件词典单测：四语键集一致、行表唯一、无空译值、无自译、
// 以及 v1.1 分段翻译管线（动态文案 / 日期 / 量词 / 用户数据保原样）
import { test } from "node:test";
import assert from "node:assert/strict";
import { DICTIONARIES, LOCALES, rowKeysUnique, translateText } from "@/plugins/i18n-multilang/dictionary";

const locales = Object.keys(DICTIONARIES);

test("词典覆盖英/日/法/俄四种语言", () => {
  assert.deepEqual(locales.sort(), ["en", "fr", "ja", "ru"]);
  assert.equal(LOCALES.length, 5); // zh + 四语
});

test("行表无重复键（重复会静默覆盖）", () => {
  assert.ok(rowKeysUnique(), "ROWS 中存在重复原文键");
});

test("四种语言键集完全一致", () => {
  const base = Object.keys(DICTIONARIES.en).sort();
  for (const loc of locales) {
    assert.deepEqual(
      Object.keys(DICTIONARIES[loc as keyof typeof DICTIONARIES]).sort(),
      base,
      `${loc} 键集与 en 不一致`,
    );
  }
});

test("无空译值且译文不等于中文原文", () => {
  for (const loc of locales) {
    const dict = DICTIONARIES[loc as keyof typeof DICTIONARIES];
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(v.trim().length > 0, `${loc}：「${k}」译文为空`);
      // 日语与中文存在合法汉字同形（如「通知」「日历」），仅对西文语种要求与原文不同
      if (loc !== "ja") assert.notEqual(v, k, `${loc}：「${k}」译文与原文相同（等于没翻）`);
    }
  }
});

test("导航与商城核心词条已收录", () => {
  const must = ["首页", "工作台", "项目", "团队", "文档", "登录", "插件商城", "启用", "停用"];
  for (const key of must) assert.ok(key in DICTIONARIES.en, `en 缺少核心词条「${key}」`);
});

test("整句精确匹配：保留首尾空白", () => {
  assert.equal(translateText("  插件商城  ", "en"), "  Plugin Store  ");
});

test("分段翻译：夹数字的计数文案", () => {
  assert.equal(translateText("2 位成员 · 1 个项目", "en"), "2 members · 1 Projects");
  assert.equal(translateText("我的待办 1 个 · 进行中 0 个 · 已完成 0 个", "en"), "My to-dos 1 · In progress 0 · Done 0");
});

test("分段翻译：问候语带用户名（全角标点做边界）", () => {
  assert.equal(translateText("早上好，陈后端", "en"), "Good morning, 陈后端");
});

test("日期模板规则：西文转 ISO/斜杠，日语保留年月日", () => {
  assert.equal(translateText("2026-11-23，0 个事件", "en"), "2026-11-23, 0 events");
  assert.equal(translateText("11月23日星期一", "en"), "11/23 Monday");
  assert.equal(translateText("11月23日星期一", "ja"), "11月23日 月曜日");
});

test("量词吞并：N 个/条/位/项/篇/步 → N", () => {
  assert.equal(translateText("敏捷校园研发组 · 3 个任务", "en"), "敏捷校园研发组 · 3 tasks");
  assert.equal(translateText("第 1 步 · 全局认知", "en"), "Step 1 · The big picture");
});

test("用户数据与未收录内容保持原文", () => {
  assert.equal(translateText("评审纪要-文档协作终测", "en"), "评审纪要-文档协作终测");
  assert.equal(translateText("E2E Test Doc", "en"), "E2E Test Doc");
  assert.equal(translateText("", "en"), "");
  const long = "很长的用户正文".repeat(30);
  assert.equal(translateText(long, "en"), long); // 超长不翻译
});
