# 房间前端来源与许可

1.1.0 沿用参考项目的功能布局和交互协议。屋内家具、建筑、菜园及作物几何依据画面和平面坐标重新建模。

- `src/room-world.js`、`src/garden-world.js` 为本次独立编写的程序化几何。上游布局、交互与第三方素材许可均保留。
- `src/garden-state.js`、`garden-ui.js`、`garden.css`：来自同一项目的菜园模块，保留原作八畦与十二种作物的实现，适配 MaiBot 服务端事实和沙箱桥，MIT；原版权声明同上。
- `upstream/vendor/three.module.js`、`GLTFLoader.js`、`BufferGeometryUtils.js`：上游随附 Three.js r160，MIT。完整许可见 `upstream/vendor/LICENSE-three.txt`。
- `licenses/INSPIRATION.md`：原房间的空间氛围与陪伴交互灵感署名，按上游要求原样保留。页面说明内保留来源入口。
- 本次适配的 `src/`、`build.mjs`：自定义 MaiBot WebUI 桥接、按需打包、响应式界面、演员播放器；源文件可编辑。

本包没有引入上游受单独授权限制的 `da-feiyu.glb`、`da-feiyu.opt.glb`，也没有引入 `dsh-pet` 的角色立绘、WebM 动画或音效。不得把原项目 MIT 代码许可理解成这些未包含素材的许可。

`assets/models/maisaka.glb`、`maisaka-hi.glb` 是用户的本地麦麦模型；`assets/maisaka-sprite.webp` 是用户批准的麦麦立绘的轻量格式副本。权利与来源以整个交付包的模型及参考图说明为准；本说明不将其重新授权为 MIT。当前用途为用户自己的本地房间展示。

构建工具 esbuild 是开发依赖，遵循其 MIT 许可；安装后的插件页面不加载 esbuild 或 npm，不依赖 CDN。
