"use client";

import { useState } from "react";
import { DocsPanel } from "../DocsPanel";
import { DocumentsPanel } from "./DocumentsPanel";

export function ProjectDocuments() {
  const [showLegacy, setShowLegacy] = useState(false);

  return (
    <>
      <div className="ws-doc-actions">
        <button className="ws-btn" onClick={() => setShowLegacy(value => !value)}>
          {showLegacy ? "返回项目文档" : "查看旧版云文档"}
        </button>
      </div>
      {showLegacy ? <DocsPanel /> : <DocumentsPanel />}
    </>
  );
}
