# 来源、作者与许可

## 原房间项目

- 仓库：[feiyu-room-template](https://github.com/sh2234113/feiyu-room-template)
- 作者：sh2234113
- 参考提交：`201a4ecad48e7e77cfdd6422fb8f55a77a7b9f5f`
- 原版权：Copyright (c) 2026 Derpyu520 and qq-bridge / QSH contributors；Copyright (c) 2026 sh2234113
- 原 MIT 许可：[licenses/LICENSE](licenses/LICENSE)

房间布局、导航规则及菜园规则参考原项目。`src/room-world.js`、`src/garden-world.js` 为重新编写的程序化几何；`garden-catalog.js`、`garden-ui.js`、`garden.css` 基于原项目菜园模块适配。MaiBot 桥接、页面生命周期、演员控制和界面适配代码随源码提供。

原房间的空间氛围与陪伴交互灵感署名按原文保存在 [licenses/INSPIRATION.md](licenses/INSPIRATION.md)。帮助面板也保留原仓库入口。

## 依赖

`upstream/vendor/three.module.js`、`GLTFLoader.js`、`BufferGeometryUtils.js` 为 Three.js r160（MIT），完整许可见 [upstream/vendor/LICENSE-three.txt](upstream/vendor/LICENSE-three.txt)。esbuild 为 MIT 开发依赖，插件运行时不加载该工具。

## 角色与图像素材

角色参考 [MaiBot 官方角色设定](https://maibot.chat/about/)。`assets/models/maisaka.glb`、`maisaka-hi.glb` 为定制麦麦模型，`assets/maisaka-sprite.webp` 为批准的角色立绘。`room-logo.webp` 为房屋与橙子 Logo。代码的 MIT 许可不改变这些角色、模型和图像素材各自的权利。

本包未包含原项目的 `da-feiyu.glb`、`da-feiyu.opt.glb` 或 `dsh-pet` 的角色立绘、WebM 动画和音效，原项目代码许可不涵盖这些独立素材。
