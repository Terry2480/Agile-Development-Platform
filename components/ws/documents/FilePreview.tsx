"use client";
import Image from "next/image";
import {useState} from "react";
export function FilePreview({file,name}:{file:{mimeType:string;size:string;url:string;preview:boolean};name:string}) {
  const [failed,setFailed]=useState(false);const src=file.url+(file.url.includes("?")?"&":"?")+"preview=1";
  return <section className="ws-document-file-preview" aria-label="文件预览">
    <div className="ws-doc-actions"><a className="ws-btn" href={file.url}>下载文件</a>{file.preview && <a className="ws-doc-link" href={src} target="_blank" rel="noopener noreferrer">在新标签页预览</a>}<small>{(Number(file.size)/1024).toFixed(1)} KB · {file.mimeType}</small></div>
    {!file.preview && <p className="ws-doc-muted">此格式暂不支持在线预览，请下载后使用对应软件打开。</p>}
    {failed && <p className="ws-error" role="alert">预览失败，文件可能缺失或浏览器不支持此格式。可尝试下载，或联系维护者核对。</p>}
    {file.preview && !failed && (file.mimeType.startsWith("image/") ? <Image unoptimized src={src} alt={name} width={800} height={450} onError={()=>setFailed(true)} style={{width:"100%",height:"auto",maxHeight:450,objectFit:"contain"}}/> : file.mimeType==="application/pdf" ? <><iframe src={src} title={`${name} PDF预览`} onError={()=>setFailed(true)}/><p className="ws-doc-muted">如果浏览器没有显示 PDF，请使用新标签页预览或下载文件。</p></> : <video src={src} controls preload="metadata" onError={()=>setFailed(true)}>浏览器不支持此视频，请下载查看。</video>)}
  </section>;
}
