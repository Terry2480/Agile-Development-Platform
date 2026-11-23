import path from "node:path";
export function fileType(bytes: Uint8Array) {
  const b=Buffer.from(bytes);
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if(b[0]===255 && b[1]===216 && b[2]===255) return "image/jpeg";
  if(b.subarray(0,4).toString()==="RIFF" && b.subarray(8,12).toString()==="WEBP") return "image/webp";
  if(["GIF87a","GIF89a"].includes(b.subarray(0,6).toString())) return "image/gif";
  if(b.subarray(0,5).toString()==="%PDF-") return "application/pdf";
  if(b.subarray(4,8).toString()==="ftyp" && ["isom","iso2","mp41","mp42","avc1","M4V "].includes(b.subarray(8,12).toString())) return "video/mp4";
  if(b.subarray(0,4).equals(Buffer.from([26,69,223,163])) && b.subarray(0,4096).includes(Buffer.from("webm"))) return "video/webm";
  return "application/octet-stream";
}
export function fileDisposition(name:string,inline:boolean) {
  return `${inline?"inline":"attachment"}; filename="download${path.extname(name).replace(/[^a-zA-Z0-9.]/g,"").slice(0,10)}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
export function byteRange(header:string|null,size:number):{start:number;end:number}|null {
  if(!header) return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m || (!m[1]&&!m[2]) || size<1) throw Error("INVALID_RANGE");
  const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  const end=m[1]?(m[2]?Math.min(size-1,Number(m[2])):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start> end||start>=size||(!m[1]&&Number(m[2])===0)) throw Error("INVALID_RANGE");
  return {start,end};
}
