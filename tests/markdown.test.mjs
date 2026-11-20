import { test } from "node:test";
import assert from "node:assert/strict";
import { extractToc, renderMarkdown } from "../lib/markdown.ts";

test("headings render with sequential anchor ids, lists, quotes, rules and code blocks render", () => {
  assert.equal(renderMarkdown("# 标题"), '<h1 id="doc-h-0">标题</h1>');
  assert.equal(renderMarkdown("###### 小标题"), '<h6 id="doc-h-0">小标题</h6>');
  assert.equal(renderMarkdown("- 甲\n- 乙"), "<ul><li>甲</li><li>乙</li></ul>");
  assert.equal(renderMarkdown("1. 甲\n2. 乙"), "<ol><li>甲</li><li>乙</li></ol>");
  assert.equal(renderMarkdown("> 引用行"), "<blockquote><p>引用行</p></blockquote>");
  assert.equal(renderMarkdown("---"), "<hr />");
  assert.equal(renderMarkdown("```\n<div>x</div>\n```"), "<pre><code>&lt;div&gt;x&lt;/div&gt;</code></pre>");
});

test("inline marks render: bold, italic, code and http(s) links only", () => {
  assert.equal(renderMarkdown("**粗**"), "<p><strong>粗</strong></p>");
  assert.equal(renderMarkdown("*斜*"), "<p><em>斜</em></p>");
  assert.equal(renderMarkdown("`<b>`"), "<p><code>&lt;b&gt;</code></p>");
  assert.equal(
    renderMarkdown("[文档](https://example.com/a?b=1)"),
    '<p><a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">文档</a></p>',
  );
  assert.equal(renderMarkdown("[坏](javascript:alert(1))"), "<p>[坏](javascript:alert(1))</p>");
});

test("all raw HTML is escaped, so script injection becomes inert text", () => {
  const evil = '<script>alert("x")</script>';
  assert.equal(renderMarkdown(evil), "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  assert.ok(!renderMarkdown(`<img src=x onerror=alert(1)>`).includes("<img"));
});

test("paragraphs keep single newlines as breaks and blank lines split blocks", () => {
  assert.equal(renderMarkdown("第一行\n第二行"), "<p>第一行<br />第二行</p>");
  assert.equal(renderMarkdown("段一\n\n段二"), "<p>段一</p>\n<p>段二</p>");
  assert.equal(renderMarkdown(""), "");
});

test("adjacent blocks combine without swallowing each other", () => {
  const md = ["# 计划", "", "说明文字", "", "- 项 A", "- 项 B", "", "```", "code()", "```"].join("\n");
  assert.equal(
    renderMarkdown(md),
    ['<h1 id="doc-h-0">计划</h1>', "<p>说明文字</p>", "<ul><li>项 A</li><li>项 B</li></ul>", "<pre><code>code()</code></pre>"].join("\n"),
  );
});

test("[[task code]] renders as a clickable task chip and stays escaped-safe", () => {
  assert.equal(
    renderMarkdown("看 [[E2E-002]] 和 [[WEB-012]]"),
    '<p>看 <button type="button" class="ws-doc-task" data-code="E2E-002">E2E-002</button> 和 <button type="button" class="ws-doc-task" data-code="WEB-012">WEB-012</button></p>',
  );
  assert.equal(renderMarkdown("[[e2e-002]]"), "<p>[[e2e-002]]</p>"); // 小写不算任务码
  assert.ok(!renderMarkdown("[[<script>]]").includes("<script"));
});

test("extractToc lists headings in order with ids matching render anchors", () => {
  const md = ["# 一级", "", "正文", "", "## 二级A", "", "```", "# 围栏内不算", "```", "", "### 三级", "", "## 二级B"].join("\n");
  const toc = extractToc(md);
  assert.deepEqual(toc, [
    { level: 1, text: "一级", id: "doc-h-0" },
    { level: 2, text: "二级A", id: "doc-h-1" },
    { level: 3, text: "三级", id: "doc-h-2" },
    { level: 2, text: "二级B", id: "doc-h-3" },
  ]);
  const html = renderMarkdown(md);
  for (const item of toc) {
    assert.ok(html.includes(`id="${item.id}"`), `缺少锚点 ${item.id}`);
  }
});
