import { execFileSync } from 'node:child_process'
import path from 'node:path'

export function resolveMainCheckoutRoot(cwd) {
  const commonDirectory = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd, encoding: 'utf8' },
  ).trim()
  const projectRoot = path.dirname(commonDirectory)
  if (projectRoot.split(path.sep).includes('.worktrees')) {
    throw new Error('无法从 Git common directory 解析主项目目录。')
  }
  return projectRoot
}

export function resolveAcceptanceDatabasePath(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot)
  if (resolvedRoot.split(path.sep).includes('.worktrees')) {
    throw new Error('验收数据库不能创建在 Git worktree 中。')
  }
  return path.join(resolvedRoot, 'data/customer-service.db')
}
