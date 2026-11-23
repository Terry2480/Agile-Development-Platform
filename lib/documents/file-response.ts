import {open} from "node:fs/promises";
import {Readable} from "node:stream";
import {uploadPath} from "@/lib/file-cleanup";
import {DocumentError} from "./errors";
import {byteRange,fileDisposition} from "./files";
export async function fileResponse(request:Request,file:{storedName:string;mimeType:string;size:string;name:string},head:boolean,forceInline=false){
    const handle=await open(/* turbopackIgnore: true */ uploadPath(file.storedName),"r").catch(()=>{throw new DocumentError(404,"FILE_MISSING","文件实体暂不可用，请联系维护者核对存储");});
    let transferred=false;
    try {
      const info=await handle.stat();
      if(!info.isFile() || String(info.size)!==file.size) throw new DocumentError(409,"FILE_CHANGED","文件实体与记录不一致，暂不可下载");
      let range;
      try{range=byteRange(request.headers.get("range"),info.size);}catch{return new Response(null,{status:416,headers:{"Content-Range":`bytes */${info.size}`,"Cache-Control":"private, no-store"}});}
      const safe=["image/png","image/jpeg","image/webp","image/gif","application/pdf","video/mp4","video/webm"].includes(file.mimeType);
      const inline=(forceInline || new URL(request.url).searchParams.get("preview")==="1") && safe;
      const start=range?.start??0,end=range?.end??info.size-1;
      const headers:Record<string,string>={"Content-Type":safe?file.mimeType:"application/octet-stream","Content-Length":String(end-start+1),"Content-Disposition":fileDisposition(file.name,inline),"Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store","Cross-Origin-Resource-Policy":"same-origin","Content-Security-Policy":"default-src 'none'; frame-ancestors 'self'"};
      if(range) headers["Content-Range"]=`bytes ${start}-${end}/${info.size}`;
      if(head || !info.size) return new Response(null,{status:range?206:200,headers});
      const stream=handle.createReadStream({start,end,autoClose:true});transferred=true;
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{status:range?206:200,headers});
    }finally{if(!transferred)await handle.close();}
}
