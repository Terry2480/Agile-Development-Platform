// 占位页：登录界面骨架
// 目前只是静态 UI，接入 Auth.js 后这里的表单才会真正生效。

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F1EA] px-4 text-[#1A1913]">
      <div className="w-full max-w-sm rounded-2xl border border-[#E8E3D8] bg-white p-8 shadow-sm">
        {/* 品牌标识 */}
        <div className="flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#294A78] font-serif text-2xl font-bold text-white">
            A
          </span>
          <h1 className="mt-4 font-serif text-xl font-semibold">AgileCampus</h1>
          <p className="mt-1 text-sm text-[#928B7E]">敏捷校园 · 项目协作平台</p>
        </div>

        {/* 登录表单（占位，暂未接入真实登录） */}
        <form className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[#514C43]">
              邮箱
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              className="w-full rounded-lg border border-[#D8D1C2] bg-white px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[#B5AEA0] focus:border-[#294A78] focus:ring-2 focus:ring-[#BCCCEA]"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[#514C43]">
              密码
            </label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              className="w-full rounded-lg border border-[#D8D1C2] bg-white px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[#B5AEA0] focus:border-[#294A78] focus:ring-2 focus:ring-[#BCCCEA]"
            />
          </div>

          <button
            type="button"
            className="w-full rounded-lg bg-[#294A78] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1E3A60]"
          >
            登录
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[#928B7E]">
          占位页面 · 登录功能将在接入 Auth.js 后启用
        </p>
      </div>
    </div>
  );
}
