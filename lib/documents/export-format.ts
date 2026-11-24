import type {BodyNode} from "./body";
import { renderMarkdown } from "../markdown";
const escape=(text:unknown)=>String(text??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function imageIds(body:BodyNode):number[]{const result=new Set<number>();function walk(n:BodyNode){if(n.type==="image")result.add(Number(n.attrs?.resourceId));for(const c of n.content??[])walk(c);}walk(body);return [...result];}
export function bodyMarkdown(body:BodyNode,image:(id:number)=>string):string {
  function render(n:BodyNode,depth=0):string {
    const children=()=>n.content?.map(c=>render(c,depth+1)).join("")??"";
    if(n.type==="markdown") return n.text ?? "";
    if(n.type==="text"){let text=(n.text??"").replace(/([\\`*_{}\[\]<>])/g,"\\$1");for(const m of n.marks??[]){if(m.type==="bold")text=`**${text}**`;if(m.type==="italic")text=`*${text}*`;if(m.type==="code")text=`\`${text}\``;if(m.type==="link")text=`[${text}](${encodeURI(String(m.attrs?.href??"")).replace(/[()]/g,c=>c==="("?"%28":"%29")})`;}return text;}
    if(n.type==="paragraph")return children()+"\n\n";
    if(n.type==="heading")return "#".repeat(Math.min(6,Math.max(1,Number(n.attrs?.level??2))))+" "+children()+"\n\n";
    if(n.type==="codeBlock")return "````\n"+(n.content?.map(c=>c.text??"").join("")??"")+"\n````\n\n";
    if(n.type==="bulletList"||n.type==="orderedList")return (n.content??[]).map((c,i)=>`${n.type==="orderedList"?`${i+1}.`:"-"} ${render(c).trim().replace(/\n/g,"\n  ")}\n`).join("")+"\n";
    if(n.type==="blockquote")return children().split("\n").map(line=>"> "+line).join("\n")+"\n\n";
    if(n.type==="hardBreak")return "  \n";
    if(n.type==="horizontalRule")return "\n---\n\n";
    if(n.type==="image")return `![${String(n.attrs?.alt??"图片").replace(/[\[\]\\]/g,"_")}](${image(Number(n.attrs?.resourceId))})\n\n`;
    if(n.type==="table"){const rows=(n.content??[]).map(row=>(row.content??[]).map(cell=>render(cell).trim().replace(/\|/g,"\\|").replace(/\n/g,"<br>")).join(" | "));return rows.length?"| "+rows[0]+" |\n| "+(n.content![0].content??[]).map(()=>"---").join(" | ")+" |\n"+rows.slice(1).map(row=>"| "+row+" |\n").join("")+"\n":"";}
    return children();
  }return render(body);
}
export function bodyHtml(body:BodyNode,image:(id:number)=>string):string {
  function render(n:BodyNode):string {
    const children=()=>n.content?.map(render).join("")??"";
    if(n.type==="markdown") return renderMarkdown(n.text ?? "");
    if(n.type==="text"){let text=escape(n.text);for(const mark of n.marks??[]){if(mark.type==="bold")text=`<strong>${text}</strong>`;if(mark.type==="italic")text=`<em>${text}</em>`;if(mark.type==="code")text=`<code>${text}</code>`;if(mark.type==="underline")text=`<u>${text}</u>`;if(mark.type==="strike")text=`<s>${text}</s>`;if(mark.type==="link"&&/^https?:\/\//.test(String(mark.attrs?.href)))text=`<a href="${escape(mark.attrs?.href)}">${text}</a>`;}return text;}
    if(n.type==="image")return `<img src="${escape(image(Number(n.attrs?.resourceId)))}" alt="${escape(n.attrs?.alt)}">`;
    if(n.type==="hardBreak")return "<br>";if(n.type==="horizontalRule")return "<hr>";
    const tags:Record<string,string>={paragraph:"p",heading:`h${Math.min(6,Math.max(1,Number(n.attrs?.level??2)))}`,bulletList:"ul",orderedList:"ol",listItem:"li",codeBlock:"pre",blockquote:"blockquote",table:"table",tableRow:"tr",tableCell:"td",tableHeader:"th",doc:"div"};const tag=tags[n.type]??"div";return `<${tag}>${children()}</${tag}>`;
  }return render(body);
}
export function htmlDocument(title:string,body:string){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>@page{size:A4;margin:18mm}body{font-family:Arial,'Microsoft YaHei','Noto Sans CJK SC',sans-serif;font-size:11pt;line-height:1.65;color:#171717;overflow-wrap:anywhere}h1{font-size:22pt}h2{font-size:17pt}h3{font-size:14pt}img{max-width:100%;max-height:240mm}table{border-collapse:collapse;width:100%;break-inside:auto}td,th{border:1px solid #aaa;padding:6px;min-width:30px}tr{break-inside:avoid}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px}a{color:#24518a}</style><body><h1>${escape(title)}</h1>${body}</body></html>`;}
