"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";

const MAX_MARKDOWN_PREVIEW_BYTES = 1024 * 1024;

function MarkdownFilePreview({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || Number(response.headers.get("content-length")) > MAX_MARKDOWN_PREVIEW_BYTES) {
          throw new Error("Markdown preview unavailable");
        }
        const content = await response.text();
        if (!controller.signal.aborted) setHtml(renderMarkdown(content));
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [url]);

  if (failed) return <p className="ws-error" role="alert">Markdown 预览失败，请下载后查看。</p>;
  if (html === null) return <p className="ws-doc-muted" role="status">正在加载 Markdown 预览…</p>;
  return <div className="ws-doc-readbody" dangerouslySetInnerHTML={{ __html: html }} />;
}


export function FilePreview({file,name}:{file:{mimeType:string;size:string;url:string;preview:boolean};name:string}) {
  const [failed,setFailed]=useState(false);const src=file.url+(file.url.includes("?")?"&":"?")+"preview=1";
  const isMarkdown = /\.(md|markdown)$/i.test(name) || /^text\/(markdown|x-markdown)(?:;|$)/i.test(file.mimeType);
  return <section className="ws-document-file-preview" aria-label="文件预览">
    <div className="ws-doc-actions"><a className="ws-btn" href={file.url}>下载文件</a>{file.preview && <a className="ws-doc-link" href={src} target="_blank" rel="noopener noreferrer">在新标签页预览</a>}<small>{(Number(file.size)/1024).toFixed(1)} KB · {file.mimeType}</small></div>
    <p className="ws-doc-muted">支持预览 PNG、JPG/JPEG、WebP、GIF、PDF、MP4、WebM、MD/Markdown（最大 1 MiB）。</p>
    {!isMarkdown && !file.preview && <p className="ws-doc-muted">此格式暂不支持在线预览，请下载后使用对应软件打开。</p>}
    {isMarkdown && (Number(file.size) <= MAX_MARKDOWN_PREVIEW_BYTES
      ? <MarkdownFilePreview url={file.url} />
      : <p className="ws-doc-muted">文件超过 1 MB，请下载后查看。</p>)}
    {failed && <p className="ws-error" role="alert">预览失败，文件可能缺失或浏览器不支持此格式。可尝试下载，或联系维护者核对。</p>}
    {file.preview && !failed && (file.mimeType.startsWith("image/") ? <Image unoptimized src={src} alt={name} width={800} height={450} onError={()=>setFailed(true)} style={{width:"100%",height:"auto",maxHeight:450,objectFit:"contain"}}/> : file.mimeType==="application/pdf" ? <><iframe src={src} title={`${name} PDF预览`} onError={()=>setFailed(true)}/><p className="ws-doc-muted">如果浏览器没有显示 PDF，请使用新标签页预览或下载文件。</p></> : <video src={src} controls preload="metadata" onError={()=>setFailed(true)}>浏览器不支持此视频，请下载查看。</video>)}
  </section>;
}
