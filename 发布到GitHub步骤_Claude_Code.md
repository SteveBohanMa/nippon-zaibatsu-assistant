# 用 Claude Code 把项目发布到 GitHub（操作步骤）

> ⚠️ **本项目为测试版（Beta）**。发布到 GitHub 时，请在仓库描述与首页 README 中明确标注「Beta / 测试版」，
> 提醒使用者：决策推荐仅供参考、数值以实体规则书为准、欢迎反馈 Issue。

本指南假设你已经把工程包解压到本地某个文件夹（例如 `D:\zaibatsu` 或 `~/zaibatsu`），
里面包含 `app/`、`main.py`、`README.md`、`.gitignore`、`LICENSE` 等文件。

---

## 一、准备工作（一次性）

1. **安装 Git**
   - Windows：到 https://git-scm.com/download/win 下载并安装。
   - macOS：终端运行 `xcode-select --install`，或用 Homebrew：`brew install git`。
   - 验证：终端/命令行运行 `git --version`，能显示版本号即可。

2. **安装 Claude Code**
   - 需要 Node.js 18+（https://nodejs.org 安装）。
   - 安装命令：`npm install -g @anthropic-ai/claude-code`
   - 验证：运行 `claude --version`。
   - 首次使用按提示登录你的 Anthropic 账号。

3. **准备 GitHub 账号**
   - 没有账号先到 https://github.com 注册。
   - 建议安装 **GitHub CLI**（让 Claude Code 能直接建仓库、推代码）：
     - Windows：`winget install --id GitHub.cli`
     - macOS：`brew install gh`
   - 安装后运行 `gh auth login`，按提示用浏览器登录授权（选择 HTTPS）。
   - 验证：`gh auth status` 显示已登录即可。

---

## 二、用 Claude Code 发布（推荐流程）

1. **进入项目文件夹**
   ```bash
   cd D:\zaibatsu        # Windows 示例
   # 或  cd ~/zaibatsu   # macOS / Linux 示例
   ```

2. **启动 Claude Code**
   ```bash
   claude
   ```

3. **把下面这段话直接发给 Claude Code**（复制粘贴即可）：

   ```
   请帮我把当前文件夹初始化为 git 仓库并发布到我的 GitHub，要求：
   1. 这是一个测试版（Beta）项目，请在 GitHub 仓库描述里加上 “Beta 测试版” 字样；
   2. 仓库名用 nippon-zaibatsu-assistant，设为 public；
   3. 确认 .gitignore 已忽略 node_modules / dist / build / __pycache__；
   4. 第一次提交信息用：「初始提交：财阀对局助手 v0.1.0-beta（测试版）」；
   5. 用 GitHub CLI（gh）创建远程仓库并推送 main 分支；
   6. 创建一个名为 v0.1.0-beta 的预发布（pre-release）标签和 Release，并在说明里标注这是测试版。
   ```

4. Claude Code 会列出它打算执行的命令（如 `git init`、`gh repo create` 等），
   **逐条确认**即可。它会自动完成建库、提交、推送、打 Beta 预发布标签。

5. 完成后它会给出仓库网址，形如：
   `https://github.com/你的用户名/nippon-zaibatsu-assistant`

---

## 三、手动命令版（不依赖 Claude Code 也能做）

如果你想自己一条条敲，按顺序执行：

```bash
# 1) 进入项目目录
cd D:\zaibatsu

# 2) 初始化仓库
git init
git add .
git commit -m "初始提交：财阀对局助手 v0.1.0-beta（测试版）"
git branch -M main

# 3) 用 GitHub CLI 创建远程仓库并推送（public）
gh repo create nippon-zaibatsu-assistant --public --source=. --remote=origin \
  --description "明治维新·财阀 对局助手（Beta 测试版）— 离线对局决策辅助" --push

# 4) 打一个 Beta 预发布标签并建 Release
git tag v0.1.0-beta
git push origin v0.1.0-beta
gh release create v0.1.0-beta --prerelease \
  --title "v0.1.0-beta（测试版）" \
  --notes "首个公开测试版（Beta）。决策推荐仅供参考，数值以实体规则书为准，欢迎提交 Issue 反馈。"
```

> 不想用 `gh` 的话：先到 GitHub 网页手动「New repository」建一个空仓库（勾选 public、不要自动加 README），
> 然后把第 3 步替换为：
> ```bash
> git remote add origin https://github.com/你的用户名/nippon-zaibatsu-assistant.git
> git push -u origin main
> ```
> Release 也可在网页 “Releases → Draft a new release” 里建，**记得勾选 “Set as a pre-release”**。

---

## 四、明确标注「测试版（Beta）」的几处

为了让任何看到仓库的人都清楚这是测试版，请确认以下位置都有 Beta 字样（本工程已预置前两项）：

1. **README 顶部**：已加入「⚠️ 测试版（Beta）声明」区块。
2. **仓库描述（About）**：建库时用 `--description` 带上「Beta 测试版」。
3. **Release / 标签**：版本号用 `v0.1.0-beta`，并在 GitHub 上勾选 **pre-release**。
4. （可选）**仓库顶部加徽章**：在 README 第一行加入
   ```markdown
   ![status](https://img.shields.io/badge/status-beta-orange) ![version](https://img.shields.io/badge/version-0.1.0--beta-blue)
   ```

---

## 五、后续更新（改完代码再发一版）

```bash
git add .
git commit -m "修复：xxx（仍为测试版）"
git push
# 需要再发布一个测试版本时：
git tag v0.1.1-beta && git push origin v0.1.1-beta
gh release create v0.1.1-beta --prerelease --title "v0.1.1-beta（测试版）" --notes "修复若干问题。"
```

---

## 六、常见问题

- **推送时要求登录**：运行 `gh auth login`（用 gh）或在弹出的浏览器/凭据管理器里登录 GitHub。
- **`gh: command not found`**：未安装 GitHub CLI，回到第一步安装，或改用「手动命令版」里的网页建库方式。
- **不想公开**：把 `--public` 改成 `--private` 即可。
- **误传了 node_modules / dist**：确认 `.gitignore` 在项目根目录且已生效；若已提交，运行
  `git rm -r --cached node_modules dist build` 后重新 `commit`、`push`。
- **想连 .exe 一起发**：先在 Windows 上跑 `build_exe.bat` 生成 `dist\财阀对局助手.exe`，
  再用 `gh release upload v0.1.0-beta "dist/财阀对局助手.exe"` 把它作为附件挂到该 Release 下
  （注意 `dist/` 已被 .gitignore 忽略，不会进源码库，仅作为 Release 附件分发）。

---

*本项目为非官方、非商业爱好者工具，《Nippon: Zaibatsu》版权归 CrowD Games 所有。*
