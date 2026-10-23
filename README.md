# Lingee Build Workspace

本工作区中的两个浏览器应用可以独立运行，启动方式如下。

## 在线访问（GitHub Pages）

- 游戏入口 / Games: https://sihuanian.github.io/games/
- 环线竞速 / APEX CIRCUIT: https://sihuanian.github.io/games/apex-circuit/
- 紫禁城 / Forbidden City 3D: https://sihuanian.github.io/games/forbidden-city-3d/public/

在仓库 **Settings → Pages → Source** 中选择 **GitHub Actions**。
推送游戏文件或入口页到 `main` 后，`Deploy games to GitHub Pages` 工作流会自动发布，
也可以在 Actions 页面手动运行。发布内容仅包含入口页及两个应用的静态资源。

## 环境要求

- **Node.js 18 或更高版本**（两个项目都只用 Node 内置的 `http` / `fs` 模块）
- 现代浏览器（`forbidden-city-3d` 需要支持 WebGL2 与 importmap）

```bash
node -v    # 建议 >= 18
```

## apex-circuit

伪 3D 街机赛车游戏。

```bash
cd apex-circuit
node server.js            # → http://localhost:5174/
```

- **零依赖**：无需 `npm install`，目录下没有 `package.json`。
- `index.html` 使用普通 `<script>` 标签，**直接用浏览器打开也能运行**，`server.js` 只提供更贴近
  真实部署的访问方式。
- 换端口：`PORT=8080 node server.js`。

玩法、操作按键与源码结构见 [`apex-circuit/README.md`](apex-circuit/README.md)。

## forbidden-city-3d

紫禁城中轴线三维重建沙盘（程序化重建午门至神武门的空间格局）。

```bash
cd forbidden-city-3d
node server.js            # → http://localhost:5173/
# 等价写法：npm run dev / npm start / npm run start
```

- **不能用 `file://` 直接打开**：页面依赖 ES Module 与 importmap，必须经 HTTP 访问。
- 访问根路径会 302 跳转到 `/public/`，页面内的相对路径（`./src/…`、`../vendor/…`）依赖这个前缀。
- `three.js` 已随仓库放在 `vendor/three/`，由 `index.html` 的 importmap 映射，
  **运行时不需要 `node_modules`**；`package.json` 中的 `three` 依赖仅用于版本对齐，
  需要时才执行 `npm install`。
- 换端口：`PORT=8080 node server.js`。

## 常见问题

- **端口被占用**：两个项目都支持 `PORT` 环境变量，例如 `PORT=8080 node server.js`；
  默认端口分别是 5174（apex-circuit）与 5173（forbidden-city-3d）。
- **`forbidden-city-3d` 页面空白**：多为直接用 `file://` 打开或未在 `forbidden-city-3d/`
  目录下执行命令导致；请用 `node server.js` 并通过 `http://localhost:5173/` 访问。
- **`apex-circuit` 提示缺少依赖**：该项目不需要安装任何依赖，直接打开 `index.html`
  或执行 `node server.js` 均可运行。
