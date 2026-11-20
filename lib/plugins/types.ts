// AgileCampus 插件标准格式（详见 docs/PLUGIN-SPEC.md）
// 插件 = 一个符合该接口的模块 + 同目录 README；放入 plugins/<id>/ 并在 registry 注册即上架商城。
export type PluginCategory = "language" | "productivity" | "theme" | "integration" | "other";

/** 插件可声明的权限点；商城据此展示，运行时按需校验 */
export type PluginPermission =
  | "ui:translate"   // 遍历并替换页面文本
  | "ui:mount"       // 向页面挂载自有界面元素
  | "storage:local"  // 读写 localStorage（plugin.<id>.* 命名空间）
  | "api:read"       // 以当前用户身份调用平台只读接口
  | "network:external"; // 访问平台外网络

/** 激活时注入插件的上下文（宿主提供的全部能力面） */
export interface PluginContext {
  /** 插件专属 localStorage 命名空间读写 */
  storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
  /** 平台只读接口（携带当前登录态） */
  api<T>(path: string): Promise<T>;
  /** 宿主版本，供插件做能力探测 */
  hostVersion: string;
}

export interface AgileCampusPlugin {
  /** 唯一标识，kebab-case，如 "i18n-multilang" */
  id: string;
  name: string;
  /** 语义化版本号 */
  version: string;
  author: string;
  description: string;
  category: PluginCategory;
  /** 展示图标（emoji 或单字符） */
  icon: string;
  permissions: PluginPermission[];
  /** 生命周期：启用时调用；返回清理函数或由 deactivate 负责 */
  activate?(ctx: PluginContext): void | Promise<void>;
  /** 生命周期：停用时必须完全还原（卸载 UI、断开观察器、还原文本） */
  deactivate?(): void;
}
