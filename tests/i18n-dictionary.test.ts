// 多语言插件词典单测：四语键集一致、无空译值、无自译（译文≠原文）
import { test } from "node:test";
import assert from "node:assert/strict";
import { DICTIONARIES } from "@/plugins/i18n-multilang/dictionary";

const locales = Object.keys(DICTIONARIES);

test("词典覆盖英/日/法/俄四种语言", () => {
  assert.deepEqual(locales.sort(), ["en", "fr", "ja", "ru"]);
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
