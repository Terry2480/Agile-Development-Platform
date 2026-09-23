# Cherry-pick 指南

## 查看候选提交

```powershell
git log --oneline proposal/student-workspace
```

## 安全采用流程

```powershell
git switch -c integrate/student-workspace
git cherry-pick <需要的提交编号>
npm install
npm run lint
npm run build
```

数据库功能通过后再执行：

```powershell
npm run db:push
npm test
```

## 撤销候选提交

如果提交已经应用但还没有推送，可以使用：

```powershell
git revert <提交编号>
```

如果 cherry-pick 发生冲突：

```powershell
git status
```

手动处理后：

```powershell
git add <已处理文件>
git cherry-pick --continue
```

不要使用 `git reset --hard` 覆盖队友未备份的工作。
