import type {BodyNode} from "./body";
export const DOCUMENT_TEMPLATES=[
  {key:"project-plan",name:"项目计划",group:"general",sections:["课程目标与成果要求","成员分工","阶段安排","风险与应对","验收标准"]},
  {key:"meeting",name:"会议纪要",group:"general",sections:["会议时间与参与成员","讨论事项","决策结论","待办与负责人","下次跟进"]},
  {key:"weekly",name:"周记录",group:"general",sections:["本周目标","完成情况与证据","遇到的问题","下周计划"]},
  {key:"retrospective",name:"阶段回顾",group:"general",sections:["阶段目标与成果","有效做法","问题与原因","改进行动与负责人"]},
  {key:"delivery",name:"交付报告",group:"general",sections:["交付范围","成果与使用说明","验收结果","已知限制","后续建议"]},
  {key:"requirements",name:"需求文档",group:"software",sections:["背景与用户","功能需求","权限与边界","异常场景","验收标准"]},
  {key:"technical-design",name:"技术设计",group:"software",sections:["系统结构","模块职责","数据设计","接口与关键流程","风险与验证"]},
  {key:"api",name:"API 文档",group:"software",sections:["接口用途与路径","认证与权限","请求参数","响应与错误","调用示例"]},
  {key:"test-report",name:"测试报告",group:"software",sections:["测试版本与环境","范围与方法","测试用例及结果","问题记录","结论与剩余风险"]},
] as const;
export function templateBody(key?:string):BodyNode {
  if(!key || key==="blank")return {type:"doc",content:[{type:"paragraph",content:[]}]};
  const template=DOCUMENT_TEMPLATES.find(t=>t.key===key);if(!template)throw Error("UNKNOWN_TEMPLATE");
  return {type:"doc",content:template.sections.flatMap(title=>[{type:"heading",attrs:{level:2},content:[{type:"text",text:title}]},{type:"paragraph",content:[{type:"text",text:"请结合本项目实际情况填写。"}]}])};
}
