# 三维几何可视化工具

使用 TypeScript、Three.js 和 Vite，支持单位正方体组合、标准三视图、六面绘制、11 类展开及每类 24 种等价具体展开、折叠演示与基础学习练习。

```sh
npm install
npm run dev
```

选中正方体后点击 **展开选中**，通过整体转动或具体展开候选调整面的位置与方向；跨类型切换延续参考状态，**回到绘制布局**可恢复实际绘图时的展开。完成后点击 **应用到立方体**。

- [实现说明、使用约定与验收](docs/实现说明与验收.md)
- [原始改进分析与分阶段路线](docs/三维几何可视化工具改进分析.md)

验证命令：`npm run build`、`npm test`、`npm run test:e2e`。浏览器回归默认使用本机 Chrome／Edge，可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`指定其他 Chromium 路径。
