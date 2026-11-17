# 房间前端

MaiBot 自定义 WebUI 协议 v2 页面，使用 Three.js r160。操作说明见 [插件说明](../README.md)，接入参数见 [API.md](../API.md)。

## 加载与资源

`src/entry.js` 负责宿主握手、可见性和资源生命周期。首次可见后才读取客户端配置、加载场景程序和角色；隐藏期间暂停渲染与状态查询，默认保留资源 600 秒，返回时立即同步，到期释放。宿主卸载 iframe 时由浏览器销毁页面。

`src/app.js` 负责状态同步、镜头、交互和渲染循环。`room-world.js` 生成房屋和家具，`follow-camera.js` 处理跟随镜头遮挡，`actor.js` 加载两档角色模型并控制动作和表情。立绘模式复用相同的位置与姿态状态，贴图按需创建。

麦麦视角从当前帧骨骼变换取得眼点和方向，保留身体及双手；外部视角继续平滑跟随。图形初始化失败或上下文中断时，入口释放旧场景并提供重试。

菜园由 `garden-client.js` 连接服务端状态，`garden-world.js` 绘制作物和工具，`garden-ui.js` 提供面板。只有点击实际田块才打开菜园。电视和专属聊天分别由 `media.js`、`chat.js` 管理，使用宿主声明的查询与动作通道。

房屋、菜园和小径共用连续地基，尺寸随布局边界扩展，路面与地板作为表面装饰。`room-visibility.js` 按镜头到角色头部及身体的有限视线检查墙体，计入墙高与门窗开口，并根据遮挡比例平滑调整整墙透明度。半透明墙使用模板缓冲，确保同一墙在每个像素只混色一次，保留原门窗和饰面。外部视角隐藏顶棚，第一人称显示室内顶棚。

标准画质默认 60 FPS，省电档为 24 FPS。模型精度与渲染画质分别选择。页面不显示互动成功浮层，失败信息留在相应面板。

## 构建

在本目录执行：

```text
npm ci
npm run build
```

构建输出 `index.html`、`runtime/room.js`、`runtime/room.js.gz`，并生成两档模型的 gzip 副本。`src/`、`assets/` 和 `upstream/vendor/` 为构建输入，必须随源码保留。安装运行不需要 Node.js、npm、开发依赖或 CDN。

入口页面仅包含样式、静态模板和加载器，构建时检查宿主的 2 MiB 单页限制。场景程序、模型和媒体通过有界分块传输，在页面内校验及解码。运行路径中的原始和压缩文件分别用于浏览器能力回退及压缩传输。

## 来源与许可

原项目为 sh2234113 的 [feiyu-room-template](https://github.com/sh2234113/feiyu-room-template)。原作者及贡献者版权、原 MIT 许可和灵感来源分别保存在 [LICENSE](licenses/LICENSE)、[INSPIRATION.md](licenses/INSPIRATION.md) 和 [第三方说明](THIRD_PARTY_NOTICES.md)。
